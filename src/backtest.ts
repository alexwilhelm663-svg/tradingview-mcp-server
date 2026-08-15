/**
 * V170 Point-in-Time Walk-Forward-Replay.
 *
 * Setup-Erkennung, Proportions-Veto, unabhaengige Clusterfamilien,
 * Pending-Transitionen und Trade-Aufloesung stammen aus denselben reinen
 * Funktionen wie im Live-Pfad. Weekly bestaetigt; Daily loest Ziel/Stop auf.
 */
import { fetchMarketData, type Candle, candleCloseTime } from "./core/marketData";
import { detectForecastSetup, type ForecastDetection } from "./core/forecast";
import {
  evaluatePendingBar,
  evaluateTradeBar,
  PENDING_TIMEOUT_DAYS,
  TRADE_TIMEOUT_DAYS,
  type FrozenSetup,
  type FrozenTrade,
} from "./core/lifecycle";
import { daysBetween, timeMs } from "./core/time";

interface SimTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  setupAsOf: string;
  entryAt: string;
  resolvedAt: string | null;
  entry: number;
  trigger: number;
  invalidation: number;
  target: number;
  clusterScore: number;
  evidenceCount: number;
  outcome: "TARGET" | "INVALIDATED" | "TIMEOUT" | "OPEN";
  pnl: number;
  r: number;
  daysHeld: number;
}

interface Simulation {
  trade: SimTrade | null;
  terminalAt: string | null;
}

const DEFAULT_UNIVERSE = [
  "MSTR", "BTC-USD", "ETH-USD", "TSLA", "NVDA", "AMD", "AAPL", "MSFT",
  "GOOGL", "META", "NFLX", "NET", "SAP", "PYPL", "KO", "ARM", "TEAM", "COIN",
];

function simulate(
  symbol: string,
  setup: ForecastDetection,
  futureWeekly: Candle[],
  daily: Candle[]
): Simulation {
  const invalidation = setup.direction === "LONG"
    ? setup.cluster.floor * 0.97
    : setup.cluster.ceiling * 1.03;
  const frozen: FrozenSetup = {
    direction: setup.direction,
    trigger: setup.trigger,
    invalidation,
    cExtreme: setup.cExtreme,
    createdAt: setup.asOf,
    asOf: setup.asOf,
    lastEvaluatedBar: null,
  };

  for (const bar of futureWeekly) {
    const pending = evaluatePendingBar(frozen, bar);
    if (pending.type === "WAIT") {
      if (pending.reason === "PENDING") frozen.lastEvaluatedBar = pending.effectiveAt;
      continue;
    }
    if (pending.type === "INVALIDATED" || pending.type === "TIMEOUT" || pending.type === "DEGENERATE") {
      return { trade: null, terminalAt: pending.effectiveAt };
    }

    const trade: FrozenTrade = {
      direction: setup.direction,
      entry: pending.entry,
      invalidation,
      target: pending.target,
      entryAt: pending.effectiveAt,
    };
    const afterEntry = daily.filter(
      (x) => timeMs(candleCloseTime(x)) > timeMs(trade.entryAt)
    );
    for (const day of afterEntry) {
      const result = evaluateTradeBar(trade, day);
      if (result.type === "WAIT") continue;
      return {
        terminalAt: result.effectiveAt,
        trade: {
          symbol,
          direction: setup.direction,
          setupAsOf: setup.asOf,
          entryAt: trade.entryAt,
          resolvedAt: result.effectiveAt,
          entry: trade.entry,
          trigger: setup.trigger,
          invalidation,
          target: trade.target,
          clusterScore: setup.cluster.score,
          evidenceCount: setup.cluster.evidenceCount,
          outcome: result.type,
          pnl: result.pnl,
          r: result.r,
          daysHeld: daysBetween(trade.entryAt, result.effectiveAt),
        },
      };
    }

    const last = afterEntry[afterEntry.length - 1];
    const s2 = setup.direction === "LONG" ? 1 : -1;
    const close = last?.close ?? trade.entry;
    const risk = Math.abs(trade.entry - invalidation);
    return {
      terminalAt: null,
      trade: {
        symbol,
        direction: setup.direction,
        setupAsOf: setup.asOf,
        entryAt: trade.entryAt,
        resolvedAt: null,
        entry: trade.entry,
        trigger: setup.trigger,
        invalidation,
        target: trade.target,
        clusterScore: setup.cluster.score,
        evidenceCount: setup.cluster.evidenceCount,
        outcome: "OPEN",
        pnl: (s2 * (close - trade.entry)) / trade.entry,
        r: risk > 0 ? (s2 * (close - trade.entry)) / risk : 0,
        daysHeld: last ? daysBetween(trade.entryAt, candleCloseTime(last)) : 0,
      },
    };
  }
  return { trade: null, terminalAt: null };
}

async function backtestSymbol(symbol: string, minHistory = 156): Promise<SimTrade[]> {
  const [weeklyMarket, dailyMarket] = await Promise.all([
    fetchMarketData(symbol, "1wk", "10y", 200),
    fetchMarketData(symbol, "1d", "10y", 500),
  ]);
  const weekly = weeklyMarket.weeklyAnalysisCandles;
  const daily = dailyMarket.weeklyAnalysisCandles;
  const trades: SimTrade[] = [];
  let occupiedUntil: string | null = null;

  for (let cut = minHistory; cut < weekly.length - 1; cut++) {
    const cutoff = candleCloseTime(weekly[cut]);
    if (occupiedUntil && timeMs(cutoff) <= timeMs(occupiedUntil)) continue;
    const visible = weekly.slice(0, cut + 1);
    const setup = detectForecastSetup(visible, {
      minClusterScore: 3,
      interval: "1wk",
      range: "expanding-10y",
    });
    if (!setup) continue;

    const simulation = simulate(symbol, setup, weekly.slice(cut + 1), daily);
    if (simulation.trade) trades.push(simulation.trade);
    if (simulation.terminalAt) occupiedUntil = simulation.terminalAt;
    else if (simulation.trade?.outcome === "OPEN") break;
    else occupiedUntil = candleCloseTime(weekly[weekly.length - 1]);
  }
  return trades;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function report(trades: SimTrade[]): void {
  const resolved = trades.filter((x) => x.outcome !== "OPEN");
  const labelled = resolved.filter((x) => x.outcome === "TARGET" || x.outcome === "INVALIDATED");
  const targets = labelled.filter((x) => x.outcome === "TARGET");
  const avgR = resolved.length > 0
    ? resolved.reduce((sum, x) => sum + x.r, 0) / resolved.length
    : 0;
  const avgPnl = resolved.length > 0
    ? resolved.reduce((sum, x) => sum + x.pnl, 0) / resolved.length
    : 0;

  console.log("\n════ V170 Point-in-Time Walk-Forward ════");
  console.log(`Trades: ${trades.length} · aufgeloest: ${resolved.length} · offen: ${trades.length - resolved.length}`);
  console.log(
    `Target-vor-Stop: ${labelled.length > 0 ? pct(targets.length / labelled.length) : "n/a"} ` +
    `(n=${labelled.length}; Timeouts nicht binaer gelabelt)`
  );
  console.log(`Expectancy: ${pct(avgPnl)} · durchschnittlich ${avgR.toFixed(2)}R`);
  console.log(
    `Identische Horizonte: Pending ${PENDING_TIMEOUT_DAYS}d · Trade ${TRADE_TIMEOUT_DAYS}d · ` +
    `Weekly Trigger / Daily Ziel-Stop.`
  );

  for (const trade of trades) {
    console.log(
      `  ${trade.symbol.padEnd(8)} ${trade.direction.padEnd(5)} ${trade.entryAt.slice(0, 10)} ` +
      `Fam${trade.clusterScore}/Ev${trade.evidenceCount} ${trade.outcome.padEnd(11)} ` +
      `PnL ${pct(trade.pnl).padStart(7)} · ${trade.r.toFixed(2)}R · ${trade.daysHeld.toFixed(0)}d`
    );
  }
}

(async () => {
  const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_UNIVERSE;
  console.log(`V170 Replay ueber ${symbols.length} Symbole...`);
  const all: SimTrade[] = [];
  for (const symbol of symbols) {
    try {
      const trades = await backtestSymbol(symbol);
      all.push(...trades);
      console.log(`  ${symbol.padEnd(8)} -> ${trades.length} Trade(s)`);
      await new Promise((resolve) => setTimeout(resolve, 400));
    } catch (error: any) {
      console.log(`  ${symbol.padEnd(8)} -> Fehler: ${error?.message ?? error}`);
    }
  }
  report(all);
})();
