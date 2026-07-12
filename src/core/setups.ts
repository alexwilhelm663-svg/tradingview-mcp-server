import db from "./db";
import { fetchMarketData, MarketData } from "./marketData";
import type { FibCluster } from "./fibCluster";

export type Fetcher = (
  symbol: string,
  interval?: string,
  range?: string,
  minCandles?: number
) => Promise<MarketData>;

export interface SetupEvent {
  symbol: string;
  type: "CONFIRMED" | "INVALIDATED" | "TIMEOUT";
  text: string;
}

const PENDING_TIMEOUT_DAYS = 84; // 12 Wochen ohne Bestaetigung -> verwerfen
const INVALIDATION_BUFFER = 0.97; // 3% unter Cluster-Boden

/**
 * Legt ein PENDING-Setup an oder aktualisiert dessen Level.
 * Ein Symbol hat maximal ein aktives Setup; abgeschlossene Setups
 * (CONFIRMED/INVALIDATED/TIMEOUT) werden bei erneutem Cluster-Kontakt ersetzt.
 */
export function upsertPendingSetup(
  symbol: string,
  cluster: FibCluster,
  triggerLevel: number | null,
  cLow: number
): "created" | "refreshed" {
  const invalidation = cluster.floor * INVALIDATION_BUFFER;
  const row = db.prepare("SELECT status FROM setups WHERE symbol = ?").get(symbol) as
    | { status: string }
    | undefined;

  if (row && row.status === "PENDING") {
    db.prepare(
      `UPDATE setups SET cluster_floor=?, cluster_ceiling=?, cluster_score=?,
       trigger_level=?, invalidation=?, c_low=?, levels=?, updated_at=CURRENT_TIMESTAMP
       WHERE symbol=?`
    ).run(
      cluster.floor,
      cluster.ceiling,
      cluster.score,
      triggerLevel,
      invalidation,
      cLow,
      JSON.stringify(cluster.labels),
      symbol
    );
    return "refreshed";
  }

  db.prepare(
    `INSERT OR REPLACE INTO setups
     (symbol, status, cluster_floor, cluster_ceiling, cluster_score, trigger_level,
      invalidation, c_low, levels, created_at, updated_at)
     VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    symbol,
    cluster.floor,
    cluster.ceiling,
    cluster.score,
    triggerLevel,
    invalidation,
    cLow,
    JSON.stringify(cluster.labels)
  );
  return "created";
}

/**
 * Prueft alle PENDING-Setups gegen die letzte ABGESCHLOSSENE Wochenkerze:
 *   Schluss > Trigger        -> CONFIRMED (Trade mit eingefrorenen Leveln)
 *   Schluss < Invalidierung  -> INVALIDATED
 *   aelter als 84 Tage       -> TIMEOUT
 * Target bei Bestaetigung: Trigger + 1.618 * (Trigger - C-Tief),
 * analog zur Screener-Konvention "Ziel = 1.618 x Subwelle i".
 */
export async function resolvePendingSetups(fetcher: Fetcher = fetchMarketData): Promise<SetupEvent[]> {
  const rows = db.prepare("SELECT * FROM setups WHERE status = 'PENDING'").all() as any[];
  const events: SetupEvent[] = [];

  for (const s of rows) {
    try {
      const { weeklyAnalysisCandles: wk } = await fetcher(s.symbol, "1wk", "1y", 10);
      if (wk.length < 2) continue;
      const lastComplete = wk[wk.length - 2];
      const created = new Date(String(s.created_at).replace(" ", "T") + "Z").getTime();
      const ageDays = (Date.now() - created) / 86_400_000;

      if (s.trigger_level != null && lastComplete.close > s.trigger_level) {
        const target = s.trigger_level + 1.618 * (s.trigger_level - s.c_low);
        db.prepare(
          "INSERT INTO trade_history (symbol, signal_type, entry_price, invalidation, target) VALUES (?, 'CLUSTER', ?, ?, ?)"
        ).run(s.symbol, lastComplete.close, s.invalidation, target);
        db.prepare(
          "UPDATE setups SET status='CONFIRMED', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
        ).run(s.symbol);
        events.push({
          symbol: s.symbol,
          type: "CONFIRMED",
          text:
            `🚀 **${s.symbol} CONFIRMED**: Wochenschluss ${lastComplete.close.toFixed(2)} über Trigger ${Number(s.trigger_level).toFixed(2)}.\n` +
            `Entry ~${lastComplete.close.toFixed(2)} · Invalidierung ${Number(s.invalidation).toFixed(2)} · Ziel (1.618·i) ${target.toFixed(2)}`,
        });
      } else if (lastComplete.close < s.invalidation) {
        db.prepare(
          "UPDATE setups SET status='INVALIDATED', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
        ).run(s.symbol);
        events.push({
          symbol: s.symbol,
          type: "INVALIDATED",
          text: `❌ **${s.symbol} INVALIDATED**: Wochenschluss ${lastComplete.close.toFixed(2)} unter Cluster-Boden (${Number(s.invalidation).toFixed(2)}).`,
        });
      } else if (ageDays >= PENDING_TIMEOUT_DAYS) {
        db.prepare(
          "UPDATE setups SET status='TIMEOUT', updated_at=CURRENT_TIMESTAMP WHERE symbol=?"
        ).run(s.symbol);
        events.push({
          symbol: s.symbol,
          type: "TIMEOUT",
          text: `⌛ **${s.symbol} TIMEOUT**: ${PENDING_TIMEOUT_DAYS} Tage ohne Bestätigung – Setup verworfen.`,
        });
      }

      await new Promise((r) => setTimeout(r, 150));
    } catch (err: any) {
      console.error(`[SETUPS] Fehler bei ${s.symbol}:`, err?.message ?? err);
    }
  }
  return events;
}

/** Kompakte Uebersicht fuer den /setups-Command. */
export function listSetups(): string {
  const rows = db
    .prepare("SELECT * FROM setups ORDER BY updated_at DESC LIMIT 15")
    .all() as any[];
  if (rows.length === 0) return "📭 Keine Setups erfasst.";
  const icon: Record<string, string> = {
    PENDING: "🟡",
    CONFIRMED: "🚀",
    INVALIDATED: "❌",
    TIMEOUT: "⌛",
  };
  const lines = rows.map((s) => {
    const zone = `${Number(s.cluster_floor).toFixed(2)}–${Number(s.cluster_ceiling).toFixed(2)}`;
    const trig = s.trigger_level != null ? Number(s.trigger_level).toFixed(2) : "n/a";
    const since = String(s.created_at).split(" ")[0];
    return `${icon[s.status] ?? "•"} **${s.symbol}** · ${s.status} · Zone ${zone} · Trigger ${trig} · seit ${since}`;
  });
  return `📋 **Setups (State Machine):**\n` + lines.join("\n");
}
