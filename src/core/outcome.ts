import db from "./db";
import { fetchMarketData, type MarketData, candleCloseTime } from "./marketData";
import { evaluateTradeBar, TRADE_TIMEOUT_DAYS, type FrozenTrade } from "./lifecycle";
import type { Direction } from "./forecast";
import { timeMs } from "./time";

export type OutcomeFetcher = (
  symbol: string,
  interval?: string,
  range?: string,
  minCandles?: number,
  asOfMs?: number
) => Promise<MarketData>;

interface OpenTrade {
  id: number;
  symbol: string;
  entry_price: number;
  invalidation: number | null;
  target: number | null;
  timestamp: string;
  entry_at: string | null;
  direction: string | null;
}

/**
 * Wertet nur Bars aus, die nach dem tatsaechlichen Entry-Bar-Schluss liegen.
 * TARGET/INVALIDATED sind binaere Labels; TIMEOUT bleibt bewusst unklassiert
 * und kann die Trefferquote nicht mehr als impliziter Misserfolg verfaelschen.
 */
export async function resolveOpenTrades(fetcher: OutcomeFetcher = fetchMarketData): Promise<void> {
  const open = db.prepare(
    `SELECT id, symbol, entry_price, invalidation, target, timestamp, entry_at, direction
     FROM trade_history
     WHERE resolution IS NULL AND is_success IS NULL`
  ).all() as OpenTrade[];
  if (open.length === 0) return;

  const closeStmt = db.prepare(
    `UPDATE trade_history
     SET outcome=?, is_success=?, resolution=?, resolved_at=?
     WHERE id=? AND resolution IS NULL`
  );
  console.log(`[OUTCOME] Pruefe ${open.length} offene Signale...`);

  for (const row of open) {
    if (row.invalidation == null || row.target == null) continue;
    try {
      const market = await fetcher(row.symbol, "1d", "6mo", 20);
      const entryAt = row.entry_at ?? String(row.timestamp);
      const direction: Direction = row.direction === "SHORT" ? "SHORT" : "LONG";
      const trade: FrozenTrade = {
        direction,
        entry: Number(row.entry_price),
        invalidation: Number(row.invalidation),
        target: Number(row.target),
        entryAt,
      };
      const relevant = market.weeklyAnalysisCandles.filter(
        (bar) => timeMs(candleCloseTime(bar)) > timeMs(entryAt)
      );

      for (const bar of relevant) {
        const decision = evaluateTradeBar(trade, bar);
        if (decision.type === "WAIT") continue;
        const success = decision.type === "TARGET" ? 1
          : decision.type === "INVALIDATED" ? 0
          : null;
        closeStmt.run(
          decision.pnl,
          success,
          decision.type,
          decision.effectiveAt,
          row.id
        );
        console.log(
          `[OUTCOME] ${row.symbol} #${row.id}: ${decision.type} am ` +
          `${decision.effectiveAt.slice(0, 10)} (${(decision.pnl * 100).toFixed(1)}%, ${decision.r.toFixed(2)}R)`
        );
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (err: any) {
      console.error(`[OUTCOME] Fehler bei ${row.symbol} #${row.id}:`, err?.message ?? err);
    }
  }
  console.log(`[OUTCOME] Einheitlicher Timeout: ${TRADE_TIMEOUT_DAYS} Kalendertage.`);
}
