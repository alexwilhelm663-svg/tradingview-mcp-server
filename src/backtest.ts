/**
 * Walk-Forward-Backtest (V119) - Standalone, kein Bot-Pfad.
 *
 * Prinzip: Fuer jeden Wochen-Stichtag t sieht die Engine NUR Kerzen <= t
 * (identischer Code-Pfad wie live: findImpulseAdaptive -> Cluster ->
 * PENDING-Bedingung). Wird ein Setup erkannt, simuliert der Tester
 * Trigger/Invalidierung/Ziel strikt gegen die Kerzen NACH t.
 * Kein Look-ahead: Level werden am Stichtag eingefroren.
 *
 * Aufruf: node dist/backtest.js SYMBOL1 SYMBOL2 ...   (Default-Universum sonst)
 */
import { fetchMarketData, Candle } from "./core/marketData";
import { findImpulseAdaptive } from "./core/impulseFinder";
import { longLevelCandidates, shortLevelCandidates, clusterLevels, FibCluster } from "./core/fibCluster";

interface SimTrade {
  symbol: string;
  direction: "LONG" | "SHORT";
  entryDate: string;
  entry: number;
  trigger: number;
  invalidation: number;
  target: number;
  clusterScore: number;
  outcome: "WIN" | "LOSS" | "TIMEOUT_WIN" | "TIMEOUT_LOSS" | "OPEN";
  pnl: number;
  r: number; // Vielfache des Risikos
  weeksHeld: number;
}

const TIMEOUT_WEEKS = 26;
let degenerateCount = 0;
const DEFAULT_UNIVERSE = [
  "MSTR", "BTC-USD", "ETH-USD", "TSLA", "NVDA", "AMD", "AAPL", "MSFT",
  "GOOGL", "META", "NFLX", "NET", "SAP", "PYPL", "KO", "ARM", "TEAM", "COIN",
];

function weeklyAtrPct(c: Candle[], n = 14): number {
  const s = c.slice(-(n + 1));
  let sum = 0, k = 0;
  for (let i = 1; i < s.length; i++) {
    const tr = Math.max(
      s[i].high - s[i].low,
      Math.abs(s[i].high - s[i - 1].close),
      Math.abs(s[i].low - s[i - 1].close)
    );
    sum += tr / s[i].close;
    k++;
  }
  return k > 0 ? (sum / k) * 100 : 4;
}

interface CorrectionLegsLite {
  aExt: number | null;
  bExt: number | null;
  cExt: number | null;
}

function legsAtCutoff(
  pivots: { index: number; date: string; price: number; kind: "H" | "L" }[],
  candles: Candle[],
  topDate: string,
  dir: 1 | -1
): CorrectionLegsLite {
  const post = pivots.filter((p) => p.date > topDate);
  const impK = dir === 1 ? "L" : "H"; // Korrektur laeuft gegen den Impuls
  const corK = dir === 1 ? "H" : "L";
  const aPool = post.filter((p) => p.kind === impK);
  if (aPool.length === 0) return { aExt: null, bExt: null, cExt: null };
  const bPool = post.filter((p) => p.kind === corK);
  if (bPool.length === 0) {
    const run = aPool.reduce((m, p) => (dir * p.price < dir * m.price ? p : m));
    return { aExt: run.price, bExt: null, cExt: null };
  }
  const b = bPool.reduce((m, p) => (dir * p.price > dir * m.price ? p : m));
  const aC = aPool.filter((p) => p.date < b.date);
  if (aC.length === 0) return { aExt: null, bExt: null, cExt: null };
  const a = aC.reduce((m, p) => (dir * p.price < dir * m.price ? p : m));
  const afterB = candles.filter((k) => k.date > b.date);
  let cExt: number | null = null;
  for (const k of afterB) {
    const v = dir === 1 ? k.low : k.high;
    if (cExt === null || dir * v < dir * cExt) cExt = v;
  }
  return { aExt: a.price, bExt: b.price, cExt };
}

/** Setup-Erkennung am Stichtag - repliziert die Engine-Bedingungen ohne DB/Chart/LLM. */
function detectSetupAtCutoff(candles: Candle[]): {
  direction: "LONG" | "SHORT";
  cluster: FibCluster;
  trigger: number | null;
  cExtreme: number;
} | null {
  const outcome = findImpulseAdaptive(candles);
  if (!outcome.impulse) return null;
  const { result, pivots } = outcome.impulse;
  const wc = result.count;
  const price = candles[candles.length - 1].close;
  const P = (l: string) => wc.points.find((x) => x.label === l);
  const w0 = P("0"), w4 = P("4"), w5 = P("5");
  if (!w0 || !w5) return null;

  const tolPct = Math.max(3.5, Math.min(7, weeklyAtrPct(candles)));

  if (wc.trend === "bullish" && price < w5.price) {
    const legs = legsAtCutoff(pivots, candles, w5.date, 1);
    const cands = longLevelCandidates({
      w0: w0.price, w5: w5.price, w4: w4?.price ?? null,
      aLow: legs.aExt, bHigh: legs.bExt,
    });
    const clusters = clusterLevels(cands, tolPct);
    const inZone = clusters.find(
      (cl) => cl.score >= 2 && price >= cl.floor * 0.97 && price <= cl.ceiling * 1.03
    );
    if (inZone && legs.cExt != null) {
      const trigger = cands.map((c) => c.price).filter((p) => p > price * 1.01).sort((a, b) => a - b)[0] ?? null;
      return { direction: "LONG", cluster: inZone, trigger, cExtreme: legs.cExt };
    }
  } else if (wc.trend === "bearish" && price > w5.price) {
    const legs = legsAtCutoff(pivots, candles, w5.date, -1);
    const cands = shortLevelCandidates({
      w0: w0.price, w5: w5.price, w4: w4?.price ?? null,
      aHigh: legs.aExt, bLow: legs.bExt,
    });
    const clusters = clusterLevels(cands, tolPct);
    const inZone = clusters.find(
      (cl) => cl.score >= 2 && price >= cl.floor * 0.97 && price <= cl.ceiling * 1.03
    );
    if (inZone && legs.cExt != null) {
      const trigger = cands.map((c) => c.price).filter((p) => p < price * 0.99).sort((a, b) => b - a)[0] ?? null;
      return { direction: "SHORT", cluster: inZone, trigger, cExtreme: legs.cExt };
    }
  }
  return null;
}

/** Vorwaerts-Simulation: erst Trigger (Wochenschluss), dann Ziel/Invalidierung. */
function simulate(
  future: Candle[],
  direction: "LONG" | "SHORT",
  cluster: FibCluster,
  trigger: number,
  cExtreme: number
): SimTrade | null {
  const s2 = direction === "LONG" ? 1 : -1;
  const invalidation = direction === "LONG" ? cluster.floor * 0.97 : cluster.ceiling * 1.03;

  // Phase 1: PENDING -> CONFIRMED oder INVALIDATED per Wochenschluss
  let entryIdx = -1;
  for (let i = 0; i < future.length; i++) {
    const c = future[i];
    if (s2 * (c.close - trigger) > 0) { entryIdx = i; break; }
    if (s2 * (c.close - invalidation) < 0) return null; // vor Trigger invalidiert -> kein Trade
  }
  if (entryIdx < 0) return null; // nie getriggert

  const entry = future[entryIdx].close;
  const target = trigger + s2 * 1.618 * Math.abs(trigger - cExtreme);
  const risk = Math.abs(entry - invalidation);
  if (risk <= 0) return null;
  // Degeneriertes Setup: Ziel liegt bei Bestaetigung bereits hinter dem
  // Entry oder bietet < 0.25 R Restpotenzial. Live-Befund (Zielformel),
  // im Backtest ausgefiltert, damit die Statistik nicht verzerrt.
  const potentialR = (s2 * (target - entry)) / risk;
  if (potentialR < 0.25) { degenerateCount++; return null; }

  // Phase 2: CONFIRMED -> Ziel/Invalidierung/Timeout
  for (let i = entryIdx + 1; i < future.length; i++) {
    const c = future[i];
    const invalHit = s2 === 1 ? c.low <= invalidation : c.high >= invalidation;
    if (invalHit) {
      const pnl = (s2 * (invalidation - entry)) / entry;
      return { symbol: "", direction, entryDate: future[entryIdx].date, entry, trigger, invalidation, target, clusterScore: cluster.score, outcome: "LOSS", pnl, r: (s2 * (invalidation - entry)) / risk, weeksHeld: i - entryIdx };
    }
    const targetHit = s2 === 1 ? c.high >= target : c.low <= target;
    if (targetHit) {
      const pnl = (s2 * (target - entry)) / entry;
      return { symbol: "", direction, entryDate: future[entryIdx].date, entry, trigger, invalidation, target, clusterScore: cluster.score, outcome: "WIN", pnl, r: (s2 * (target - entry)) / risk, weeksHeld: i - entryIdx };
    }
    if (i - entryIdx >= TIMEOUT_WEEKS) {
      const pnl = (s2 * (c.close - entry)) / entry;
      return { symbol: "", direction, entryDate: future[entryIdx].date, entry, trigger, invalidation, target, clusterScore: cluster.score, outcome: pnl > 0 ? "TIMEOUT_WIN" : "TIMEOUT_LOSS", pnl, r: (s2 * (c.close - entry)) / risk, weeksHeld: i - entryIdx };
    }
  }
  const last = future[future.length - 1];
  const pnl = (s2 * (last.close - entry)) / entry;
  return { symbol: "", direction, entryDate: future[entryIdx].date, entry, trigger, invalidation, target, clusterScore: cluster.score, outcome: "OPEN", pnl, r: (s2 * (last.close - entry)) / risk, weeksHeld: future.length - 1 - entryIdx };
}

async function backtestSymbol(symbol: string, minHistory = 156): Promise<SimTrade[]> {
  const { weeklyAnalysisCandles: all } = await fetchMarketData(symbol, "1wk", "10y", 200);
  const trades: SimTrade[] = [];
  let cooldownUntil = -1;

  for (let cut = minHistory; cut < all.length - 1; cut++) {
    if (cut <= cooldownUntil) continue;
    const visible = all.slice(0, cut + 1); // Kerzen bis einschl. Stichtag
    let setup: ReturnType<typeof detectSetupAtCutoff>;
    try {
      setup = detectSetupAtCutoff(visible);
    } catch {
      continue;
    }
    if (!setup || setup.trigger == null) continue;

    const sim = simulate(all.slice(cut + 1), setup.direction, setup.cluster, setup.trigger, setup.cExtreme);
    if (sim && sim.outcome !== "OPEN") {
      sim.symbol = symbol;
      trades.push(sim);
      // Cooldown: bis zum Trade-Ende, sonst zaehlt dasselbe Setup mehrfach
      const endOffset = future0Offset(all, cut, sim);
      cooldownUntil = endOffset;
    } else if (sim && sim.outcome === "OPEN") {
      cooldownUntil = all.length; // offenes Setup -> Rest ueberspringen
    }
  }
  return trades;
}

function future0Offset(all: Candle[], cut: number, sim: SimTrade): number {
  const entryIdx = all.findIndex((c) => c.date === sim.entryDate);
  return (entryIdx >= 0 ? entryIdx : cut) + sim.weeksHeld;
}

function pct(x: number): string { return (x * 100).toFixed(1) + "%"; }

function report(trades: SimTrade[]): void {
  if (trades.length === 0) {
    console.log("Keine abgeschlossenen Trades im Testzeitraum.");
    return;
  }
  const groups: Record<string, SimTrade[]> = { ALLE: trades };
  for (const t of trades) {
    (groups[t.direction] ??= []).push(t);
    (groups[`Score ${t.clusterScore >= 3 ? ">=3" : "=2"}`] ??= []).push(t);
  }
  console.log("\n════ Walk-Forward-Ergebnis ════");
  for (const [name, g] of Object.entries(groups)) {
    const wins = g.filter((t: SimTrade) => t.outcome === "WIN" || t.outcome === "TIMEOUT_WIN");
    const wr = wins.length / g.length;
    const avgR = g.reduce((s, t) => s + t.r, 0) / g.length;
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const losses = g.filter((t) => !wins.includes(t));
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const expectancy = wr * avgWin + (1 - wr) * avgLoss;
    console.log(
      `${name.padEnd(10)} n=${String(g.length).padStart(3)} | Trefferquote ${pct(wr).padStart(6)} | ⌀R ${avgR.toFixed(2).padStart(5)} | ⌀Win ${pct(avgWin).padStart(6)} | ⌀Loss ${pct(avgLoss).padStart(7)} | Expectancy ${pct(expectancy)}`
    );
  }
  console.log("\nEinzeltrades:");
  for (const t of trades) {
    console.log(
      `  ${t.symbol.padEnd(8)} ${t.direction.padEnd(5)} ${t.entryDate} Score${t.clusterScore} ` +
      `${t.outcome.padEnd(12)} PnL ${pct(t.pnl).padStart(7)} R ${t.r.toFixed(2).padStart(5)} (${t.weeksHeld} Wo.)`
    );
  }
}

(async () => {
  const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_UNIVERSE;
  console.log(`Walk-Forward über ${symbols.length} Symbole (Timeout ${TIMEOUT_WEEKS} Wo., Cooldown bis Trade-Ende)...`);
  const all: SimTrade[] = [];
  for (const s of symbols) {
    try {
      const t = await backtestSymbol(s);
      console.log(`  ${s.padEnd(8)} -> ${t.length} Trade(s)`);
      all.push(...t);
      await new Promise((r) => setTimeout(r, 400));
    } catch (e: any) {
      console.log(`  ${s.padEnd(8)} -> Fehler: ${e?.message ?? e}`);
    }
  }
  console.log(`\nDegenerierte Setups (Ziel <0.25R hinter Entry, Live-Zielformel-Befund): ${degenerateCount}`);
  report(all);
  process.exit(0);
})();
