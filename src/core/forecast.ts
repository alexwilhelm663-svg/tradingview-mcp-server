import type { Candle } from "./marketData";
import { candleCloseTime, hashCandles } from "./marketData";
import type { Pivot } from "./zigzag";
import {
  findImpulseAdaptive,
  type AdaptiveImpulse,
  type WaveCount,
} from "./impulseFinder";
import { checkProportion } from "./proportion";
import {
  clusterLevels,
  longLevelCandidates,
  shortLevelCandidates,
  type FibCluster,
  type LevelCandidate,
} from "./fibCluster";
import { classifyCorrection, type CorrectionRead } from "./correction";
import { addDaysIso, daysBetween } from "./time";

export const ENGINE_VERSION = "171.0.0";
export type Direction = "LONG" | "SHORT";

export interface ForecastDetection {
  direction: Direction;
  cluster: FibCluster;
  trigger: number;
  cExtreme: number;
  timeStatus: "IN_WINDOW" | "OUTSIDE_WINDOW" | "UNKNOWN";
  timeWindow: { from: string; to: string } | null;
  asOf: string;
  dataHash: string;
  interval: string;
  range: string;
  count: WaveCount;
  threshold: number;
  engineVersion: string;
  provider: "yahoo-chart";
  adjustment: "RAW_PROVIDER_OHLC";
}

export type ForecastGate =
  | "SETUP"
  | "WATCH"
  | "NO_ZONE"
  | "IMPULSE_ACTIVE"
  | "NO_C_EXTREME"
  | "OUTSIDE_WINDOW"
  | "NO_TRIGGER";

/**
 * Vollstaendige, aber rein diagnostische Sicht auf denselben Forecast-Pfad.
 * `/deep` darf damit Zonen und Gates zeigen, ohne eine zweite Signal-Engine
 * nachzubauen. `setup` ist exakt das Ergebnis von `detectForecastSetup`.
 */
export interface ForecastInspection {
  direction: Direction;
  price: number;
  phase: "IMPULSE_ACTIVE" | "CORRECTION";
  gate: ForecastGate;
  minClusterScore: number;
  candidates: LevelCandidate[];
  clusters: FibCluster[];
  watchCluster: FibCluster | null;
  setup: ForecastDetection | null;
  candidateTrigger: number | null;
  cExtreme: number | null;
  correction: CorrectionRead | null;
  timeStatus: ForecastDetection["timeStatus"];
  timeWindow: ForecastDetection["timeWindow"];
  asOf: string;
  dataHash: string;
  interval: string;
  range: string;
  count: WaveCount;
  threshold: number;
  engineVersion: string;
  provider: "yahoo-chart";
  adjustment: "RAW_PROVIDER_OHLC";
}

export interface DetectOptions {
  minClusterScore?: number;
  interval?: string;
  range?: string;
  impulse?: AdaptiveImpulse;
}

interface Legs {
  a: number | null;
  aDate: string | null;
  b: number | null;
  bDate: string | null;
  c: number | null;
}

function weeklyAtrPct(candles: Candle[], n = 14): number {
  const s = candles.slice(-(n + 1));
  let sum = 0;
  let k = 0;
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

/** Exakt eine spiegelbare A-B-C-Leg-Extraktion fuer Live und Replay. */
function correctionLegs(
  pivots: Pivot[],
  candles: Candle[],
  topDate: string,
  dir: 1 | -1
): Legs {
  const empty: Legs = { a: null, aDate: null, b: null, bDate: null, c: null };
  const post = pivots.filter((p) => p.date > topDate);
  const aKind = dir === 1 ? "L" : "H";
  const bKind = dir === 1 ? "H" : "L";
  const aPool = post.filter((p) => p.kind === aKind);
  if (aPool.length === 0) return empty;

  const a = aPool[0];
  const b = post.find((p) => p.kind === bKind && p.date > a.date) ?? null;
  if (!b) return { ...empty, a: a.price, aDate: a.date };

  const cPivot = aPool.find((p) => p.date > b.date) ?? null;
  let c = cPivot?.price ?? null;
  let cDate = cPivot?.date ?? null;
  if (c == null) {
    for (const bar of candles.filter((x) => x.date > b.date)) {
      const px = dir === 1 ? bar.low : bar.high;
      if (c == null || dir * px < dir * c) {
        c = px;
        cDate = bar.date;
      }
    }
  }

  // Lange Korrekturen duerfen das erste C nur bei materieller Fortsetzung
  // nachziehen; identisch zur Live-Konvention ab V142.
  if (c != null && cDate != null) {
    let running = c;
    for (const bar of candles) {
      const px = dir === 1 ? bar.low : bar.high;
      if (bar.date > cDate && dir * px < dir * running) running = px;
    }
    const move = dir === 1
      ? Math.log(c) - Math.log(running)
      : Math.log(running) - Math.log(c);
    if (move > 0.22) c = running;
  }

  return { a: a.price, aDate: a.date, b: b.price, bDate: b.date, c };
}

function timeWindow(
  candles: Candle[],
  topDate: string,
  aDate: string | null,
  bDate: string | null
): { status: ForecastDetection["timeStatus"]; window: { from: string; to: string } | null } {
  if (!aDate || !bDate) return { status: "UNKNOWN", window: null };
  const durationA = daysBetween(topDate, aDate);
  if (durationA <= 0) return { status: "UNKNOWN", window: null };
  const from = addDaysIso(bDate, 0.618 * durationA);
  const to = addDaysIso(bDate, 1.618 * durationA);
  const last = candles[candles.length - 1].date;
  return {
    status: last >= from && last <= to ? "IN_WINDOW" : "OUTSIDE_WINDOW",
    window: { from, to },
  };
}

export function forecastInvalidation(x: Pick<ForecastDetection, "direction" | "cluster">): number {
  return x.direction === "LONG" ? x.cluster.floor * 0.97 : x.cluster.ceiling * 1.03;
}

export function forecastTarget(
  x: Pick<ForecastDetection, "direction" | "trigger" | "cExtreme">
): number {
  const s = x.direction === "LONG" ? 1 : -1;
  return x.trigger + s * 1.618 * Math.abs(x.trigger - x.cExtreme);
}

/**
 * Kanonische Diagnose inklusive schwacher Zonen und Gate-Grund. Sie benutzt
 * dieselben Legs, Kandidaten, Familien, Toleranzen und Zeitregeln wie das
 * produktive Signal. Keine der Informationen veraendert den Signalzustand.
 */
export function inspectForecastSetup(
  candles: Candle[],
  options: DetectOptions = {}
): ForecastInspection | null {
  if (candles.length < 6) return null;
  const minClusterScore = options.minClusterScore ?? 3;
  const adaptive = options.impulse ?? findImpulseAdaptive(
    candles,
    (r) => checkProportion(candles, r.count).ok
  ).impulse;
  if (!adaptive) return null;

  const wc = adaptive.result.count;
  const point = (label: string) => wc.points.find((p) => p.label === label) ?? null;
  const w0 = point("0");
  const w4 = point("4");
  const w5 = point("5");
  if (!w0 || !w5) return null;

  const dir: 1 | -1 = wc.trend === "bullish" ? 1 : -1;
  const direction: Direction = dir === 1 ? "LONG" : "SHORT";
  const price = candles[candles.length - 1].close;
  const phase: ForecastInspection["phase"] = dir === 1
    ? price < w5.price ? "CORRECTION" : "IMPULSE_ACTIVE"
    : price > w5.price ? "CORRECTION" : "IMPULSE_ACTIVE";

  const legs = phase === "CORRECTION"
    ? correctionLegs(adaptive.pivots, candles, w5.date, dir)
    : { a: null, aDate: null, b: null, bDate: null, c: null };

  const candidates: LevelCandidate[] = dir === 1
    ? longLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aLow: legs.a,
        bHigh: legs.b,
      })
    : shortLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aHigh: legs.a,
        bLow: legs.b,
      });

  let correction: CorrectionRead | null = null;
  if (legs.a != null && legs.b != null) {
    correction = classifyCorrection(
      w5.price,
      legs.a,
      legs.b,
      legs.c,
      price,
      adaptive.pivots.filter((p) => p.date > w5.date),
      dir,
      {
        candles,
        parentThreshold: adaptive.threshold,
        topDate: w5.date,
        aDate: legs.aDate,
        bDate: legs.bDate,
        impulseOrigin: w0.price,
        impulseEnd: w5.price,
      }
    );
    if (correction.targetPrice != null && correction.targetLabel != null) {
      candidates.push({
        price: correction.targetPrice,
        label: correction.targetLabel,
        family: "CORRECTION_PATTERN",
      });
      candidates.sort((a, b) => a.price - b.price);
    }
  }

  const tw = timeWindow(candles, w5.date, legs.aDate, legs.bDate);
  const tolerance = Math.max(3.5, Math.min(7, weeklyAtrPct(candles)));
  const clusters = clusterLevels(candidates, tolerance);
  const inRange = (cluster: FibCluster) =>
    price >= cluster.floor * 0.97 && price <= cluster.ceiling * 1.03;
  const watchCluster = clusters.find((x) => x.score >= 2 && inRange(x)) ?? null;
  const strongCluster = clusters.find((x) => x.score >= minClusterScore && inRange(x)) ?? null;
  const candidateTrigger = candidates
    .map((x) => x.price)
    .filter((x) => dir === 1 ? x > price * 1.01 : x < price * 0.99)
    .sort((a, b) => dir === 1 ? a - b : b - a)[0] ?? null;

  const last = candles[candles.length - 1];
  const common = {
    asOf: candleCloseTime(last),
    dataHash: hashCandles(candles),
    interval: options.interval ?? "1wk",
    range: options.range ?? "5y",
    count: wc,
    threshold: adaptive.threshold,
    engineVersion: ENGINE_VERSION,
    provider: "yahoo-chart" as const,
    adjustment: "RAW_PROVIDER_OHLC" as const,
  };

  let gate: ForecastGate;
  if (phase === "IMPULSE_ACTIVE") gate = "IMPULSE_ACTIVE";
  else if (legs.c == null) gate = "NO_C_EXTREME";
  else if (tw.status === "OUTSIDE_WINDOW") gate = "OUTSIDE_WINDOW";
  else if (!strongCluster) gate = watchCluster ? "WATCH" : "NO_ZONE";
  else if (candidateTrigger == null) gate = "NO_TRIGGER";
  else gate = "SETUP";

  const setup: ForecastDetection | null = gate === "SETUP" && strongCluster &&
      candidateTrigger != null && legs.c != null
    ? {
        direction,
        cluster: strongCluster,
        trigger: candidateTrigger,
        cExtreme: legs.c,
        timeStatus: tw.status,
        timeWindow: tw.window,
        ...common,
      }
    : null;

  return {
    direction,
    price,
    phase,
    gate,
    minClusterScore,
    candidates,
    clusters,
    watchCluster,
    setup,
    candidateTrigger,
    cExtreme: legs.c,
    correction,
    timeStatus: tw.status,
    timeWindow: tw.window,
    ...common,
  };
}

/**
 * Kanonischer, reiner Setup-Detektor. Er ist der einzige Signalpfad fuer
 * Live-Engine und Walk-Forward-Replay. Nur bestaetigte Pivots und geschlossene
 * Bars gelangen hinein; das C-Zeitfenster ist ein echtes Gate.
 */
export function detectForecastSetup(
  candles: Candle[],
  options: DetectOptions = {}
): ForecastDetection | null {
  return inspectForecastSetup(candles, options)?.setup ?? null;
}
