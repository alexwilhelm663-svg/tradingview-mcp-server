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
import { classifyCorrection } from "./correction";
import { addDaysIso, daysBetween } from "./time";

export const ENGINE_VERSION = "170.0.0";
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

/**
 * Kanonischer, reiner Setup-Detektor. Er ist der einzige Signalpfad fuer
 * Live-Engine und Walk-Forward-Replay. Nur bestaetigte Pivots und geschlossene
 * Bars gelangen hinein; das C-Zeitfenster ist ein echtes Gate.
 */
export function detectForecastSetup(
  candles: Candle[],
  options: DetectOptions = {}
): ForecastDetection | null {
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
  if (dir === 1 ? price >= w5.price : price <= w5.price) return null;

  const legs = correctionLegs(adaptive.pivots, candles, w5.date, dir);
  if (legs.c == null) return null;

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

  if (legs.a != null && legs.b != null) {
    const correction = classifyCorrection(
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
  if (tw.status === "OUTSIDE_WINDOW") return null;

  const tolerance = Math.max(3.5, Math.min(7, weeklyAtrPct(candles)));
  const inRange = (cluster: FibCluster) =>
    price >= cluster.floor * 0.97 && price <= cluster.ceiling * 1.03;
  const cluster = clusterLevels(candidates, tolerance)
    .find((x) => x.score >= minClusterScore && inRange(x));
  if (!cluster) return null;

  const trigger = candidates
    .map((x) => x.price)
    .filter((x) => dir === 1 ? x > price * 1.01 : x < price * 0.99)
    .sort((a, b) => dir === 1 ? a - b : b - a)[0];
  if (trigger == null) return null;

  const last = candles[candles.length - 1];
  return {
    direction,
    cluster,
    trigger,
    cExtreme: legs.c,
    timeStatus: tw.status,
    timeWindow: tw.window,
    asOf: candleCloseTime(last),
    dataHash: hashCandles(candles),
    interval: options.interval ?? "1wk",
    range: options.range ?? "5y",
    count: wc,
    threshold: adaptive.threshold,
    engineVersion: ENGINE_VERSION,
    provider: "yahoo-chart",
    adjustment: "RAW_PROVIDER_OHLC",
  };
}
