import fs from "fs";
import path from "path";
import db from "./db";
import { fetchMarketData, Candle } from "./marketData";
import { renderChart } from "./chart";
import { zigzag, Pivot } from "./zigzag";
import { longLevelCandidates, clusterLevels, FibCluster } from "./fibCluster";
import { upsertPendingSetup } from "./setups";
import { ewAnalyzerWorkflow, WaveCount, WavePoint } from "../graph/ewValidator";

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

/** A-Tief, B-Hoch und C-Tief der laufenden Korrektur nach dem Impuls-Top. */
function correctionLegs(
  pivots: Pivot[],
  candles: Candle[],
  topDate: string
): { aLow: number | null; bHigh: number | null; cLow: number | null } {
  const post = pivots.filter((p) => p.date > topDate);
  const aPivot = post.find((p) => p.kind === "L");
  if (!aPivot) return { aLow: null, bHigh: null, cLow: null };

  const bCandidates = post.filter((p) => p.kind === "H" && p.date > aPivot.date);
  if (bCandidates.length === 0) return { aLow: aPivot.price, bHigh: null, cLow: null };
  const bPivot = bCandidates.reduce((m, p) => (p.price > m.price ? p : m));

  const afterB = candles.filter((k) => k.date > bPivot.date);
  const cLow = afterB.length > 0 ? Math.min(...afterB.map((k) => k.low)) : null;
  return { aLow: aPivot.price, bHigh: bPivot.price, cLow };
}

export async function analyzeAsset(symbol: string): Promise<AnalysisResult> {
  try {
    // 1. Lern-Kontext laden
    const statsPath = path.join(process.cwd(), "knowledge/statistics/winrates.md");
    const stats = fs.existsSync(statsPath)
      ? fs.readFileSync(statsPath, "utf-8")
      : "Keine Statistik verfuegbar.";

    // 2. Marktdaten (Weekly, 5 Jahre) + deterministische Pivots
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol);
    const currentPrice = candles[candles.length - 1].close;
    const pivots = zigzag(candles, 25);

    // 3. LangGraph-Workflow (LLM-Zaehlung, an Pivots verankert & validiert)
    const finalState = await ewAnalyzerWorkflow.invoke(
      {
        symbol,
        marketData: candles,
        pivots,
        systemContext: `Aktuelle Performance-Daten:\n${stats}\nNutze diese, um die Wahrscheinlichkeit des Setups zu gewichten.`,
      },
      { configurable: { thread_id: `${symbol}-${Date.now()}` } }
    );

    if (!finalState.isValid || !finalState.waveCount) {
      console.warn(
        `[ENGINE] ${symbol}: keine valide Zaehlung nach ${finalState.attempts} Versuchen. Fehler: ${finalState.errorLogs.join(" | ")}`
      );
      return EMPTY;
    }

    const wc = finalState.waveCount as WaveCount;
    const w0 = pt(wc, "0");
    const w1 = pt(wc, "1");
    const w2 = pt(wc, "2");
    const w4 = pt(wc, "4");
    const w5 = pt(wc, "5");

    // 4a. Fib-Cluster-Logik (ersetzt die alte Kill-Zone)
    let pendingCreated = false;
    let clusterInfo = "";
    let chartClusters: { floor: number; ceiling: number; score: number; labels: string[] }[] | undefined;
    let chartMarkers: { price: number; label: string }[] = [];

    if (w0 && w5 && wc.trend === "bullish" && currentPrice < w5.price) {
      const legs = correctionLegs(pivots, candles, w5.date);
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

      // Konfluenz-Pflicht: ein einzelnes Level ist kein Cluster
      chartClusters = clusters.slice(0, 8).map((cl) => ({
        floor: cl.floor,
        ceiling: cl.ceiling,
        score: cl.score,
        labels: cl.labels,
      }));
      if (overhead != null) chartMarkers.push({ price: overhead, label: "Trigger" });

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

    // 4b. Breakout-Setup (unveraendert: hat einen echten Trigger + Fib-Target)
    let isBreakoutSetup = false;
    let breakoutStatus = "";
    if (w1 && currentPrice >= w1.price && currentPrice <= w1.price * 1.1) {
      isBreakoutSetup = true;
      breakoutStatus = `🚀 AUSBRUCH ueber Welle-1-Niveau (${w1.price.toFixed(2)})!`;
      if (w0 && w2) {
        const target = w2.price + 1.618 * (w1.price - w0.price);
        db.prepare(
          "INSERT INTO trade_history (symbol, signal_type, entry_price, invalidation, target) VALUES (?, 'BREAKOUT', ?, ?, ?)"
        ).run(symbol, currentPrice, w2.price, target);
      }
    }

    // 5. Chart rendern
    const buffer = await renderChart({
      symbol,
      waves: wc.points,
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
