import fs from "fs";
import path from "path";
import db from "./db";
import { fetchMarketData, Candle } from "./marketData";
import { renderChart } from "./chart";
import type { Pivot } from "./zigzag";
import { longLevelCandidates, clusterLevels } from "./fibCluster";
import { upsertPendingSetup } from "./setups";
import { findImpulseAdaptive, WaveCount, WavePoint } from "./impulseFinder";
import { getCommentary } from "./commentary";

export interface AnalysisResult {
  buffer: Buffer | null;
  signal: "YES" | "NO";
  finalTrend: string;
  pendingCreated: boolean;
  clusterInfo: string;
  isBreakoutSetup: boolean;
  breakoutStatus: string;
  analysis: WaveCount | null;
}

const EMPTY: AnalysisResult = {
  buffer: null,
  signal: "NO",
  finalTrend: "NONE",
  pendingCreated: false,
  clusterInfo: "",
  isBreakoutSetup: false,
  breakoutStatus: "",
  analysis: null,
};

function pt(wc: WaveCount, label: string): WavePoint | undefined {
  return wc.points.find((p) => p.label === label);
}

/** Durchschnittliche woechentliche True Range in % (ATR-adaptive Cluster-Toleranz). */
function weeklyAtrPct(c: Candle[], n = 14): number {
  const s = c.slice(-(n + 1));
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

interface CorrectionLegs {
  aLow: number | null;
  aDate: string | null;
  bHigh: number | null;
  bDate: string | null;
  cLow: number | null;
  cDate: string | null;
}

/** A-Tief, B-Hoch und bisheriges C-Tief der laufenden Korrektur nach dem Impuls-Top. */
function correctionLegs(pivots: Pivot[], candles: Candle[], topDate: string): CorrectionLegs {
  const empty: CorrectionLegs = {
    aLow: null, aDate: null, bHigh: null, bDate: null, cLow: null, cDate: null,
  };
  const post = pivots.filter((p) => p.date > topDate);
  const lows = post.filter((p) => p.kind === "L");
  if (lows.length === 0) return empty;

  const highs = post.filter((p) => p.kind === "H");
  if (highs.length === 0) {
    // Korrektur noch ohne Gegenbewegung: bisheriges A-Tief melden
    const running = lows.reduce((m, p) => (p.price < m.price ? p : m));
    return { ...empty, aLow: running.price, aDate: running.date };
  }
  // B = hoechstes H nach dem Top; A = TIEFSTES L zwischen Top und B
  // (nicht das erste L - das war der V112-Bug, der die C-Projektionen
  // an einem Ein-Wochen-Dip verankerte).
  const bPivot = highs.reduce((m, p) => (p.price > m.price ? p : m));
  const aCandidates = lows.filter((p) => p.date < bPivot.date);
  if (aCandidates.length === 0) return empty;
  const aPivot = aCandidates.reduce((m, p) => (p.price < m.price ? p : m));

  const afterB = candles.filter((k) => k.date > bPivot.date);
  let cLow: number | null = null;
  let cDate: string | null = null;
  for (const k of afterB) {
    if (cLow === null || k.low < cLow) {
      cLow = k.low;
      cDate = k.date;
    }
  }
  return {
    aLow: aPivot.price, aDate: aPivot.date,
    bHigh: bPivot.price, bDate: bPivot.date,
    cLow, cDate,
  };
}

export async function analyzeAsset(symbol: string): Promise<AnalysisResult> {
  try {
    // 1. Marktdaten (Weekly, 5 Jahre) + deterministische Pivots
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol);
    const currentPrice = candles[candles.length - 1].close;

    // 2. Deterministische Impulszaehlung (V113.1): adaptive Aufloesungs-Leiter
    const adaptive = findImpulseAdaptive(candles);
    if (!adaptive) {
      console.warn(`[ENGINE] ${symbol}: keine regelkonforme Impulszaehlung auf keiner ZigZag-Stufe (25/18/12/8%) ableitbar.`);
      return EMPTY;
    }
    const { result: impulse, pivots, threshold } = adaptive;
    const wc = impulse.count;
    console.log(`[ENGINE] ${symbol}: ${wc.trend}-Impuls, Score ${impulse.score}/${impulse.maxScore}${impulse.doctrineAnchor ? " (Doktrin-Anker)" : " (Fallback-Anker)"} · ZigZag ${threshold}%`);

    const w0 = pt(wc, "0");
    const w1 = pt(wc, "1");
    const w2 = pt(wc, "2");
    const w4 = pt(wc, "4");
    const w5 = pt(wc, "5");

    // 3a. Fib-Cluster-Logik (bullische Korrektur nach abgeschlossenem Impuls)
    let pendingCreated = false;
    let clusterInfo = "";
    let chartClusters: { floor: number; ceiling: number; score: number; labels: string[] }[] | undefined;
    let chartMarkers: { price: number; label: string }[] = [];
    let legs: CorrectionLegs = {
      aLow: null, aDate: null, bHigh: null, bDate: null, cLow: null, cDate: null,
    };

    if (w0 && w5 && wc.trend === "bullish" && currentPrice < w5.price) {
      legs = correctionLegs(pivots, candles, w5.date);
      const cands = longLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aLow: legs.aLow,
        bHigh: legs.bHigh,
      });
      // ATR-adaptive Toleranz (Skill-Prinzip): 3.5%..7%, je nach Volatilitaet
      const tolPct = Math.max(3.5, Math.min(7, weeklyAtrPct(candles)));
      const clusters = clusterLevels(cands, tolPct);
      const overhead = cands
        .map((c) => c.price)
        .filter((p) => p > currentPrice * 1.01)
        .sort((a, b) => a - b)[0] ?? null;

      chartClusters = clusters.slice(0, 8).map((cl) => ({
        floor: cl.floor,
        ceiling: cl.ceiling,
        score: cl.score,
        labels: cl.labels,
      }));
      if (overhead != null) chartMarkers.push({ price: overhead, label: "Trigger" });

      // Konfluenz-Pflicht: ein einzelnes Level ist kein Cluster
      const inZone = clusters.find(
        (cl) => cl.score >= 2 && currentPrice >= cl.floor * 0.97 && currentPrice <= cl.ceiling * 1.03
      );

      if (inZone && legs.cLow != null) {
        chartMarkers.push({ price: inZone.floor * 0.97, label: "Invalidierung" });
        const res = upsertPendingSetup(symbol, inZone, overhead, legs.cLow);
        pendingCreated = res === "created";
        clusterInfo =
          `🟡 **PENDING**: Kurs im Fib-Cluster ${inZone.floor.toFixed(2)}–${inZone.ceiling.toFixed(2)} ` +
          `(Score ${inZone.score}: ${inZone.labels.join(", ")}).\n` +
          `Trigger: Wochenschluss > ${overhead != null ? overhead.toFixed(2) : "n/a"} · ` +
          `Invalidierung: Wochenschluss < ${(inZone.floor * 0.97).toFixed(2)}`;
      } else {
        const below = clusters
          .filter((cl) => cl.score >= 2 && cl.ceiling < currentPrice)
          .sort((a, b) => b.ceiling - a.ceiling)[0] ??
          clusters.filter((cl) => cl.ceiling < currentPrice).sort((a, b) => b.ceiling - a.ceiling)[0];
        clusterInfo = below
          ? `⚪ Kein aktives Setup. Nächster Long-Cluster darunter: ${below.floor.toFixed(2)}–${below.ceiling.toFixed(2)} ` +
            `(Score ${below.score}: ${below.labels.join(", ")})` +
            (overhead != null ? ` · Overhead-Trigger: ${overhead.toFixed(2)}` : "")
          : "⚪ Kein Fib-Cluster unterhalb des Kurses ableitbar.";
      }
    }

    // 3b. Breakout-Setup (unveraendert: echter Trigger + Fib-Target)
    let isBreakoutSetup = false;
    let breakoutStatus = "";
    if (w1 && wc.trend === "bullish" && currentPrice >= w1.price && currentPrice <= w1.price * 1.1) {
      isBreakoutSetup = true;
      breakoutStatus = `🚀 AUSBRUCH ueber Welle-1-Niveau (${w1.price.toFixed(2)})!`;
      if (w0 && w2) {
        const target = w2.price + 1.618 * (w1.price - w0.price);
        db.prepare(
          "INSERT INTO trade_history (symbol, signal_type, entry_price, invalidation, target) VALUES (?, 'BREAKOUT', ?, ?, ?)"
        ).run(symbol, currentPrice, w2.price, target);
      }
    }

    // 4. Optionale LLM-Zweitmeinung (ausserhalb des kritischen Pfads)
    const comment = await getCommentary(symbol, wc, currentPrice, clusterInfo);
    if (comment) wc.analysis += `\n💬 ${comment}`;

    // 5. Chart: Impuls + Korrektur-Anhang + Engine-Level rendern
    const chartWaves: WavePoint[] = [...wc.points];
    if (legs.aLow != null && legs.aDate != null) {
      chartWaves.push({ label: "A", date: legs.aDate, price: legs.aLow });
      if (legs.bHigh != null && legs.bDate != null) {
        chartWaves.push({ label: "B", date: legs.bDate, price: legs.bHigh });
        if (legs.cLow != null && legs.cDate != null && legs.cLow < legs.bHigh) {
          chartWaves.push({ label: "C", date: legs.cDate, price: legs.cLow });
        }
      }
    }

    const buffer = await renderChart({
      symbol,
      waves: chartWaves,
      candles,
      clusters: chartClusters,
      markers: chartMarkers,
    });

    return {
      buffer,
      signal: pendingCreated || isBreakoutSetup ? "YES" : "NO",
      finalTrend: wc.trend,
      pendingCreated,
      clusterInfo,
      isBreakoutSetup,
      breakoutStatus,
      analysis: wc,
    };
  } catch (err: any) {
    console.error(`[ENGINE] Analysefehler ${symbol}:`, err?.message ?? err);
    return EMPTY;
  }
}
