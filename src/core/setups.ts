import { createHash } from "node:crypto";
import db from "./db";
import { fetchMarketData, type MarketData, candleCloseTime } from "./marketData";
import type { FibCluster } from "./fibCluster";
import type { WaveCount } from "./impulseFinder";
import { ENGINE_VERSION, type Direction } from "./forecast";
import { evaluatePendingBar, PENDING_TIMEOUT_DAYS, type FrozenSetup } from "./lifecycle";
import { daysBetween } from "./time";

export type Fetcher = (
  symbol: string,
  interval?: string,
  range?: string,
  minCandles?: number,
  asOfMs?: number
) => Promise<MarketData>;

export interface SetupEvent {
  symbol: string;
  type: "CONFIRMED" | "INVALIDATED" | "TIMEOUT" | "DEGENERATE";
  text: string;
}

const INVALIDATION_BUFFER = 0.97;

export interface SnapshotMeta {
  asOf: string;
  dataHash: string;
  provider: "yahoo-chart";
  adjustment: "RAW_PROVIDER_OHLC";
  engineVersion: string;
  interval: string;
  range: string;
  count: WaveCount;
}

export interface SetupMeta {
  llmConfidence: number | null;
  llmFlags: string[];
  detFlags: string[];
  snapshot?: SnapshotMeta;
}

function snapshotId(
  symbol: string,
  direction: Direction,
  snapshot: SnapshotMeta
): string {
  return createHash("sha256")
    .update([symbol, direction, snapshot.asOf, snapshot.dataHash, snapshot.engineVersion].join("|"))
    .digest("hex")
    .slice(0, 32);
}

function appendEvent(
  id: string,
  symbol: string,
  type: string,
  effectiveAt: string,
  payload: unknown
): void {
  db.prepare(
    `INSERT OR IGNORE INTO setup_events
     (snapshot_id, symbol, event_type, effective_at, payload)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, symbol, type, effectiveAt, JSON.stringify(payload));
}

/**
 * Erstellt einen unveraenderlichen Signal-Snapshot. Ein laufendes PENDING
 * wird niemals aufgefrischt; neue Scans duerfen weder Trigger noch Zone oder
 * Invalidierung rueckwirkend veraendern.
 */
export function upsertPendingSetup(
  symbol: string,
  cluster: FibCluster,
  triggerLevel: number | null,
  cExtreme: number,
  meta: SetupMeta = { llmConfidence: null, llmFlags: [], detFlags: [] },
  direction: Direction = "LONG"
): "created" | "unchanged" {
  if (triggerLevel == null || !Number.isFinite(triggerLevel)) return "unchanged";
  const invalidation = direction === "LONG"
    ? cluster.floor * INVALIDATION_BUFFER
    : cluster.ceiling * (2 - INVALIDATION_BUFFER);
  const active = db.prepare(
    "SELECT snapshot_id FROM setups WHERE symbol = ? AND status = 'PENDING'"
  ).get(symbol) as { snapshot_id: string | null } | undefined;
  if (active) return "unchanged";

  const fallbackAsOf = new Date().toISOString();
  const snapshot: SnapshotMeta = meta.snapshot ?? {
    asOf: fallbackAsOf,
    dataHash: "legacy-no-data-hash",
    provider: "yahoo-chart",
    adjustment: "RAW_PROVIDER_OHLC",
    engineVersion: ENGINE_VERSION,
    interval: "unknown",
    range: "unknown",
    count: { trend: direction === "LONG" ? "bullish" : "bearish", points: [], analysis: "legacy" },
  };
  const id = snapshotId(symbol, direction, snapshot);
  const exists = db.prepare("SELECT 1 FROM signal_snapshots WHERE id = ?").get(id);
  if (exists) return "unchanged";

  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO signal_snapshots
       (id, symbol, direction, as_of, data_hash, data_provider, adjustment,
        engine_version, interval, range_name,
        count_json, cluster_floor, cluster_ceiling, cluster_score,
        cluster_evidence_count, cluster_families, levels, trigger_level,
        invalidation, c_extreme, llm_confidence, llm_flags, det_flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      symbol,
      direction,
      snapshot.asOf,
      snapshot.dataHash,
      snapshot.provider,
      snapshot.adjustment,
      snapshot.engineVersion,
      snapshot.interval,
      snapshot.range,
      JSON.stringify(snapshot.count),
      cluster.floor,
      cluster.ceiling,
      cluster.score,
      cluster.evidenceCount,
      JSON.stringify(cluster.families),
      JSON.stringify(cluster.labels),
      triggerLevel,
      invalidation,
      cExtreme,
      meta.llmConfidence,
      JSON.stringify(meta.llmFlags),
      JSON.stringify(meta.detFlags)
    );

    db.prepare(
      `INSERT OR REPLACE INTO setups
       (symbol, status, cluster_floor, cluster_ceiling, cluster_score, trigger_level,
        invalidation, c_low, levels, llm_confidence, llm_flags, det_flags, direction,
        snapshot_id, as_of, data_hash, engine_version, count_json, interval_name,
        range_name, last_evaluated_bar, created_at, updated_at)
       VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).run(
      symbol,
      cluster.floor,
      cluster.ceiling,
      cluster.score,
      triggerLevel,
      invalidation,
      cExtreme,
      JSON.stringify(cluster.labels),
      meta.llmConfidence,
      JSON.stringify(meta.llmFlags),
      JSON.stringify(meta.detFlags),
      direction,
      id,
      snapshot.asOf,
      snapshot.dataHash,
      snapshot.engineVersion,
      JSON.stringify(snapshot.count),
      snapshot.interval,
      snapshot.range
    );
    appendEvent(id, symbol, "CREATED", snapshot.asOf, {
      direction,
      triggerLevel,
      invalidation,
      cExtreme,
      cluster,
    });
  });
  create();
  return "created";
}

function parseFlags(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Wertet jede seit dem Snapshot neu geschlossene Wochenkerze chronologisch aus. */
export async function resolvePendingSetups(fetcher: Fetcher = fetchMarketData): Promise<SetupEvent[]> {
  const rows = db.prepare("SELECT * FROM setups WHERE status = 'PENDING'").all() as any[];
  const events: SetupEvent[] = [];

  for (const s of rows) {
    try {
      const market = await fetcher(s.symbol, "1wk", "2y", 10);
      const id = String(s.snapshot_id ?? `legacy-${s.symbol}-${s.created_at}`);
      const direction: Direction = s.direction === "SHORT" ? "SHORT" : "LONG";
      const asOf = String(s.as_of ?? s.created_at);
      const frozen: FrozenSetup = {
        direction,
        trigger: Number(s.trigger_level),
        invalidation: Number(s.invalidation),
        cExtreme: Number(s.c_low),
        createdAt: String(s.created_at),
        asOf,
        lastEvaluatedBar: s.last_evaluated_bar == null ? null : String(s.last_evaluated_bar),
      };

      const bars = market.weeklyAnalysisCandles.filter((bar) => {
        const close = candleCloseTime(bar);
        const lower = frozen.lastEvaluatedBar ?? frozen.asOf;
        return Date.parse(close) > Date.parse(lower);
      });
      let terminal = false;

      for (const bar of bars) {
        const decision = evaluatePendingBar(frozen, bar);
        if (decision.type === "WAIT") {
          if (decision.reason === "PENDING") {
            db.prepare(
              "UPDATE setups SET last_evaluated_bar=?, updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND status='PENDING'"
            ).run(decision.effectiveAt, s.symbol);
            frozen.lastEvaluatedBar = decision.effectiveAt;
          }
          continue;
        }

        if (decision.type === "CONFIRMED" || decision.type === "DEGENERATE") {
          const status = decision.type === "CONFIRMED" ? "CONFIRMED" : "CONFIRMED_NO_TRADE";
          const transition = db.transaction(() => {
            if (decision.type === "CONFIRMED") {
              const allFlags = [...parseFlags(s.det_flags), ...parseFlags(s.llm_flags)];
              db.prepare(
                `INSERT OR IGNORE INTO trade_history
                 (signal_id, snapshot_id, symbol, signal_type, entry_price, invalidation,
                  target, confidence, flags, direction, entry_at, data_hash, engine_version)
                 VALUES (?, ?, ?, 'CLUSTER', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(
                id,
                id,
                s.symbol,
                decision.entry,
                s.invalidation,
                decision.target,
                s.llm_confidence,
                JSON.stringify(allFlags),
                direction,
                decision.effectiveAt,
                s.data_hash,
                s.engine_version ?? ENGINE_VERSION
              );
            }
            db.prepare(
              `UPDATE setups SET status=?, last_evaluated_bar=?, updated_at=CURRENT_TIMESTAMP
               WHERE symbol=? AND status='PENDING'`
            ).run(status, decision.effectiveAt, s.symbol);
            appendEvent(id, s.symbol, decision.type, decision.effectiveAt, decision);
          });
          transition();

          events.push({
            symbol: s.symbol,
            type: decision.type,
            text: decision.type === "CONFIRMED"
              ? `${direction === "LONG" ? "🚀" : "🔻"} **${s.symbol} CONFIRMED (${direction})**: ` +
                `Wochenschluss ${decision.entry.toFixed(2)} · Entry ${decision.effectiveAt.slice(0, 10)} · ` +
                `Invalidierung ${Number(s.invalidation).toFixed(2)} · Ziel ${decision.target.toFixed(2)}`
              : `⚠️ **${s.symbol} CONFIRMED (${direction}) ohne Trade**: Restpotenzial ` +
                `${decision.potentialR.toFixed(2)}R (< 0.25R).`,
          });
          terminal = true;
          break;
        }

        const status = decision.type;
        const transition = db.transaction(() => {
          db.prepare(
            `UPDATE setups SET status=?, last_evaluated_bar=?, updated_at=CURRENT_TIMESTAMP
             WHERE symbol=? AND status='PENDING'`
          ).run(status, decision.effectiveAt, s.symbol);
          appendEvent(id, s.symbol, status, decision.effectiveAt, decision);
        });
        transition();
        events.push({
          symbol: s.symbol,
          type: status,
          text: status === "INVALIDATED"
            ? `❌ **${s.symbol} INVALIDATED**: erster neuer Wochenschluss ` +
              `${decision.effectiveAt.slice(0, 10)} jenseits ${Number(s.invalidation).toFixed(2)}.`
            : `⌛ **${s.symbol} TIMEOUT**: ${PENDING_TIMEOUT_DAYS} Tage ohne Bestaetigung.`,
        });
        terminal = true;
        break;
      }

      // Ein Setup kann auch ohne neue Wochenkerze ablaufen. Diese Transition
      // nutzt den aktuellen UTC-Zeitpunkt und veraendert keine Preislevel.
      if (!terminal && daysBetween(String(s.created_at), new Date().toISOString()) >= PENDING_TIMEOUT_DAYS) {
        const effectiveAt = new Date().toISOString();
        const transition = db.transaction(() => {
          db.prepare(
            "UPDATE setups SET status='TIMEOUT', updated_at=CURRENT_TIMESTAMP WHERE symbol=? AND status='PENDING'"
          ).run(s.symbol);
          appendEvent(id, s.symbol, "TIMEOUT", effectiveAt, { reason: "wall-clock" });
        });
        transition();
        events.push({
          symbol: s.symbol,
          type: "TIMEOUT",
          text: `⌛ **${s.symbol} TIMEOUT**: ${PENDING_TIMEOUT_DAYS} Tage ohne Bestaetigung.`,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (err: any) {
      console.error(`[SETUPS] Fehler bei ${s.symbol}:`, err?.message ?? err);
    }
  }
  return events;
}

export function listSetups(): string {
  const rows = db.prepare("SELECT * FROM setups ORDER BY updated_at DESC LIMIT 15").all() as any[];
  if (rows.length === 0) return "📭 Keine Setups erfasst.";
  const icon: Record<string, string> = {
    PENDING: "🟡",
    CONFIRMED: "🚀",
    CONFIRMED_NO_TRADE: "⚠️",
    INVALIDATED: "❌",
    TIMEOUT: "⌛",
  };
  const lines = rows.map((s) => {
    const direction = s.direction === "SHORT" ? "⬇️" : "⬆️";
    const zone = `${direction} ${Number(s.cluster_floor).toFixed(2)}–${Number(s.cluster_ceiling).toFixed(2)}`;
    const trigger = s.trigger_level != null ? Number(s.trigger_level).toFixed(2) : "n/a";
    const since = String(s.created_at).split(" ")[0];
    return `${icon[s.status] ?? "•"} **${s.symbol}** · ${s.status} · Zone ${zone} · Trigger ${trigger} · seit ${since}`;
  });
  return `📋 **Setups (append-only Events):**\n` + lines.join("\n");
}
