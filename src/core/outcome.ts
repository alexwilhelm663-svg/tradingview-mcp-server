import db from "./db";
import { fetchMarketData } from "./marketData";

interface OpenTrade {
  id: number;
  symbol: string;
  entry_price: number;
  invalidation: number | null;
  target: number | null;
  timestamp: string;
}

const TIMEOUT_DAYS = 30;

/**
 * Prueft alle offenen Signale gegen die eingefrorenen Level:
 *   Invalidierung beruehrt -> INVALIDATED (is_success = 0)
 *   Target beruehrt        -> CONFIRMED   (is_success = 1)
 *   >30 Tage offen         -> TIMEOUT     (nach PnL bewertet)
 * Chronologische Pruefung Kerze fuer Kerze; bei Beruehrung beider Level
 * in derselben Kerze zaehlt konservativ die Invalidierung.
 */
export async function resolveOpenTrades(): Promise<void> {
  const open = db
    .prepare(
      "SELECT id, symbol, entry_price, invalidation, target, timestamp FROM trade_history WHERE is_success IS NULL"
    )
    .all() as OpenTrade[];
  if (open.length === 0) return;

  const closeStmt = db.prepare(
    "UPDATE trade_history SET outcome = ?, is_success = ? WHERE id = ?"
  );
  console.log(`[OUTCOME] Pruefe ${open.length} offene Signale...`);

  for (const t of open) {
    try {
      const { weeklyAnalysisCandles: candles } = await fetchMarketData(
        t.symbol,
        "1d",
        "3mo"
      );
      const entryDate = t.timestamp.split(" ")[0];
      const relevant = candles.filter((c) => c.date >= entryDate);

      let resolved = false;
      for (const c of relevant) {
        if (t.invalidation != null && c.low <= t.invalidation) {
          const pnl = (t.invalidation - t.entry_price) / t.entry_price;
          closeStmt.run(pnl, 0, t.id);
          console.log(`[OUTCOME] ${t.symbol} #${t.id}: INVALIDIERT am ${c.date} (${(pnl * 100).toFixed(1)}%)`);
          resolved = true;
          break;
        }
        if (t.target != null && c.high >= t.target) {
          const pnl = (t.target - t.entry_price) / t.entry_price;
          closeStmt.run(pnl, 1, t.id);
          console.log(`[OUTCOME] ${t.symbol} #${t.id}: TARGET erreicht am ${c.date} (+${(pnl * 100).toFixed(1)}%)`);
          resolved = true;
          break;
        }
      }

      if (!resolved) {
        const ts = new Date(t.timestamp.replace(" ", "T") + "Z").getTime();
        const ageDays = (Date.now() - ts) / 86_400_000;
        if (ageDays >= TIMEOUT_DAYS && relevant.length > 0) {
          const last = relevant[relevant.length - 1].close;
          const pnl = (last - t.entry_price) / t.entry_price;
          closeStmt.run(pnl, pnl > 0 ? 1 : 0, t.id);
          console.log(`[OUTCOME] ${t.symbol} #${t.id}: TIMEOUT nach ${TIMEOUT_DAYS}d (${(pnl * 100).toFixed(1)}%)`);
        }
      }

      // Yahoo-Drosselung
      await new Promise((r) => setTimeout(r, 150));
    } catch (err: any) {
      console.error(`[OUTCOME] Fehler bei ${t.symbol} #${t.id}:`, err?.message ?? err);
    }
  }
}
