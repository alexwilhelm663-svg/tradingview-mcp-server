import fs from "fs";
import path from "path";
import db from "./db";
import { fetchMarketData, Candle } from "./marketData";
import { renderChart } from "./chart";
import type { Pivot } from "./zigzag";
import { longLevelCandidates, shortLevelCandidates, clusterLevels } from "./fibCluster";
import { upsertPendingSetup, SetupMeta } from "./setups";
import { findImpulseAdaptive, WaveCount, WavePoint } from "./impulseFinder";
import { getCritique, Critique } from "./commentary";
import { classifyCorrection, CorrectionRead } from "./correction";
import { detectDiagonal } from "./diagonal";
import { assessCompletion, CompletionRead } from "./completion";
import { assessQuality } from "./quality";

export interface AnalysisResult {
  buffer: Buffer | null;
  signal: "YES" | "NO";
  finalTrend: string;
  pendingCreated: boolean;
  clusterInfo: string;
  isBreakoutSetup: boolean;
  breakoutStatus: string;
  analysis: WaveCount | null;
  commentary: string | null;
  abstention: string | null;
  detailBuffer: Buffer | null; // Sub-Struktur-Chart (V118.1)
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
  commentary: null,
  abstention: null,
  detailBuffer: null,
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

interface CorrectionLegsShort {
  aHigh: number | null;
  aDate: string | null;
  bLow: number | null;
  bDate: string | null;
  cHigh: number | null;
  cDate: string | null;
}

/** Spiegel von correctionLegs: Aufwaertskorrektur nach dem Impuls-TIEF. */
function correctionLegsShort(
  pivots: Pivot[],
  candles: Candle[],
  bottomDate: string
): CorrectionLegsShort {
  const empty: CorrectionLegsShort = {
    aHigh: null, aDate: null, bLow: null, bDate: null, cHigh: null, cDate: null,
  };
  const post = pivots.filter((p) => p.date > bottomDate);
  const highs = post.filter((p) => p.kind === "H");
  if (highs.length === 0) return empty;

  const lows = post.filter((p) => p.kind === "L");
  if (lows.length === 0) {
    const running = highs.reduce((m, p) => (p.price > m.price ? p : m));
    return { ...empty, aHigh: running.price, aDate: running.date };
  }
  // B = tiefstes L nach dem Tief; A = HOECHSTES H davor
  const bPivot = lows.reduce((m, p) => (p.price < m.price ? p : m));
  const aCandidates = highs.filter((p) => p.date < bPivot.date);
  if (aCandidates.length === 0) return empty;
  const aPivot = aCandidates.reduce((m, p) => (p.price > m.price ? p : m));

  const afterB = candles.filter((k) => k.date > bPivot.date);
  let cHigh: number | null = null;
  let cDate: string | null = null;
  for (const k of afterB) {
    if (cHigh === null || k.high > cHigh) {
      cHigh = k.high;
      cDate = k.date;
    }
  }
  return { aHigh: aPivot.price, aDate: aPivot.date, bLow: bPivot.price, bDate: bPivot.date, cHigh, cDate };
}

const addDaysE = (iso: string, d: number): string => {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + Math.round(d));
  return x.toISOString().split("T")[0];
};
const daysBetweenE = (a: string, b: string): number =>
  (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000;

export async function analyzeAsset(symbol: string): Promise<AnalysisResult> {
  try {
    // 1. Marktdaten (Weekly, 5 Jahre) + deterministische Pivots
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol);
    const currentPrice = candles[candles.length - 1].close;

    // 2. Deterministische Impulszaehlung (V113.1) mit Enthaltungs-Gebot (DK-7)
    const outcome = findImpulseAdaptive(candles);
    if (outcome.impulse === null) {
      console.log(`[ENGINE] ${symbol}: Enthaltung (DK-7) - ${outcome.abstention}`);
      const buffer = await renderChart({ symbol, waves: [], candles });
      return { ...EMPTY, buffer, abstention: outcome.abstention };
    }
    const { result: impulse, pivots, threshold } = outcome.impulse;
    const wc = impulse.count;

    // 2b. Deterministische Qualitaets-Checks (V114 Stufe 1):
    // Divergenz + Subwellen-Struktur erweitern den Score, Negativbefunde werden Flags.
    const quality = assessQuality(candles, wc, threshold);
    wc.analysis += ` · ${quality.summary}`;

    // V118 (DK-9): Ist Welle 5 wirklich fertig - oder laeuft der Impuls noch?
    const completion: CompletionRead | null = assessCompletion(candles, wc, threshold);
    if (completion) {
      wc.analysis += `\n${completion.status === "IN_PROGRESS" ? "⏳" : "🏁"} ${completion.note}`;
      if (completion.projections.length > 0) {
        wc.analysis +=
          " Ziele: " +
          completion.projections.map((p) => `${p.label} ${p.price.toFixed(2)}`).join(" · ");
      }
      for (const tw of completion.timeWindows) {
        wc.analysis += ` · ${tw.label}: ${tw.start} – ${tw.end}`;
      }
    }
    const totalScore = impulse.score + quality.bonus;
    const totalMax = impulse.maxScore + quality.maxBonus;
    console.log(`[ENGINE] ${symbol}: ${wc.trend}-Impuls, Score ${totalScore}/${totalMax}${impulse.doctrineAnchor ? " (Doktrin-Anker)" : " (Fallback-Anker)"} · ZigZag ${threshold}%${quality.flags.length > 0 ? " · ⚠️ " + quality.flags.join(",") : ""}`);

    // Stufe 2 (V114): strukturierte LLM-Kritik - optional, ausserhalb des
    // Hinweis V115: Die Korrektur-Lesart (KO-2/3/4) entsteht erst nach dem
    // Gating und ist rein deterministisch - sie geht nicht in die Kritik ein.
    // kritischen Pfads. Wirkt NUR als Vorsichts-Asymmetrie: schwache Kritik
    // hebt die Setup-Anforderungen an, aendert aber nie die Zaehlung.
    const critique: Critique | null = await getCritique(
      symbol, wc, currentPrice, quality.summary, quality.flags
    );
    if (critique) {
      console.log(
        `[KRITIK] ${symbol}: Confidence ${critique.confidence}${critique.flags.length > 0 ? " · " + critique.flags.join(",") : ""}`
      );
    }
    const cautious = critique != null && (critique.confidence < 40 || critique.flags.length >= 2);
    const minClusterScore = cautious ? 3 : 2;

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
    const chartTimeWindows: { start: string; end: string; label: string }[] = [];
    let legs: CorrectionLegs = {
      aLow: null, aDate: null, bHigh: null, bDate: null, cLow: null, cDate: null,
    };

    let correction: CorrectionRead | null = null;
    if (w0 && w5 && wc.trend === "bullish" && currentPrice < w5.price) {
      legs = correctionLegs(pivots, candles, w5.date);
      const cands = longLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aLow: legs.aLow,
        bHigh: legs.bHigh,
      });

      // V116 (DG-1): Ending Diagonal in der laufenden C-Welle?
      // Terminales Muster -> rein informativ + Flag (DK-6: nie Trigger-lockernd).
      let edInC = false;
      if (legs.bDate != null) {
        const cSegment = candles.filter((k) => k.date >= legs.bDate!);
        const diag = detectDiagonal(cSegment, wc.trend === "bullish" ? -1 : 1);
        if (diag) edInC = true;
      }

      // V115 (KO-2/3/4): Korrektur-Lesart + musterabhaengiges C-Ziel
      if (legs.aLow != null && legs.bHigh != null) {
        correction = classifyCorrection(
          w5.price, legs.aLow, legs.bHigh, legs.cLow, currentPrice,
          pivots.filter((pv) => pv.date > w5.date)
        );
        if (correction.targetPrice != null && correction.targetLabel != null) {
          cands.push({ price: correction.targetPrice, label: correction.targetLabel });
          cands.sort((a, b) => a.price - b.price);
        }
        if (edInC) {
          correction.text += ` · ⚡ Ending Diagonal in C erkannt (DG-1) – terminales Muster, erhöhte Umkehr-Wahrscheinlichkeit`;
        }
      }
      // ATR-adaptive Toleranz (Skill-Prinzip): 3.5%..7%, je nach Volatilitaet
      // V120b: Zeitfenster-Projektion des C-Endes (Koenz):
      // ueblich 0.618-1.618 Fib-Zeit der Welle A, ab B-Ende.
      if (correction && legs.aDate != null && legs.bDate != null) {
        const durA = daysBetweenE(w5.date, legs.aDate);
        if (durA > 0) {
          const fromD = addDaysE(legs.bDate, 0.618 * durA);
          const toD = addDaysE(legs.bDate, 1.618 * durA);
          if (toD >= candles[candles.length - 1].date) {
            chartTimeWindows.push({ start: fromD, end: toD, label: "C-Fenster 0.618–1.618×A" });
            correction.text += ` · C-Zeitfenster ${fromD} – ${toD}`;
          }
        }
      }

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

      // Konfluenz-Pflicht: ein einzelnes Level ist kein Cluster.
      // Bei schwacher Kritik (cautious) steigt die Anforderung auf Score >= 3.
      const inRange = (cl: { floor: number; ceiling: number }): boolean =>
        currentPrice >= cl.floor * 0.97 && currentPrice <= cl.ceiling * 1.03;
      const baselineZone = clusters.find((cl) => cl.score >= 2 && inRange(cl));
      const inZone = clusters.find((cl) => cl.score >= minClusterScore && inRange(cl));

      if (inZone && legs.cLow != null) {
        chartMarkers.push({ price: inZone.floor * 0.97, label: "Invalidierung" });
        const res = upsertPendingSetup(symbol, inZone, overhead, legs.cLow, {
          llmConfidence: critique?.confidence ?? null,
          llmFlags: critique?.flags ?? [],
          detFlags: edInC ? [...quality.flags, "ED_IN_C_TERMINAL"] : quality.flags,
        });
        pendingCreated = res === "created";
        clusterInfo =
          `🟡 **PENDING**: Kurs im Fib-Cluster ${inZone.floor.toFixed(2)}–${inZone.ceiling.toFixed(2)} ` +
          `(Score ${inZone.score}: ${inZone.labels.join(", ")}).\n` +
          `Trigger: Wochenschluss > ${overhead != null ? overhead.toFixed(2) : "n/a"} · ` +
          `Invalidierung: Wochenschluss < ${(inZone.floor * 0.97).toFixed(2)}` +
          (correction ? `\n${correction.text}` : "");
      } else {
        const below = clusters
          .filter((cl) => cl.score >= 2 && cl.ceiling < currentPrice)
          .sort((a, b) => b.ceiling - a.ceiling)[0] ??
          clusters.filter((cl) => cl.ceiling < currentPrice).sort((a, b) => b.ceiling - a.ceiling)[0];
        const gateNote =
          cautious && baselineZone
            ? `🛡️ Score-2-Zone ${baselineZone.floor.toFixed(2)}–${baselineZone.ceiling.toFixed(2)} übersprungen ` +
              `(Kritik: Confidence ${critique!.confidence}${critique!.flags.length > 0 ? ", " + critique!.flags.join(", ") : ""}) – konservatives Gating verlangt Score ≥ 3.\n`
            : "";
        clusterInfo = gateNote + (below
          ? `⚪ Kein aktives Setup. Nächster Long-Cluster darunter: ${below.floor.toFixed(2)}–${below.ceiling.toFixed(2)} ` +
            `(Score ${below.score}: ${below.labels.join(", ")})` +
            (overhead != null ? ` · Overhead-Trigger: ${overhead.toFixed(2)}` : "")
          : "⚪ Kein Fib-Cluster unterhalb des Kurses ableitbar.")
          + (correction ? `\n${correction.text}` : "");
      }
    }

    // 3a-S (V117): SPIEGEL-Block fuer vollendete BEARISHE Impulse.
    // Bewusst dupliziert statt abstrahiert: der Long-Pfad bleibt dadurch
    // byte-identisch (Regressionsschutz). Refactor-Kandidat.
    let legsS: CorrectionLegsShort = {
      aHigh: null, aDate: null, bLow: null, bDate: null, cHigh: null, cDate: null,
    };
    if (w0 && w5 && wc.trend === "bearish" && currentPrice > w5.price) {
      legsS = correctionLegsShort(pivots, candles, w5.date);

      let edInC = false;
      if (legsS.bDate != null) {
        const cSegment = candles.filter((k) => k.date >= legsS.bDate!);
        const diag = detectDiagonal(cSegment, 1);
        if (diag) edInC = true;
      }

      const cands = shortLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aHigh: legsS.aHigh,
        bLow: legsS.bLow,
      });

      let correctionS: CorrectionRead | null = null;
      if (legsS.aHigh != null && legsS.bLow != null) {
        correctionS = classifyCorrection(
          w5.price, legsS.aHigh, legsS.bLow, legsS.cHigh, currentPrice,
          pivots.filter((pv) => pv.date > w5.date), -1
        );
        if (correctionS.targetPrice != null && correctionS.targetLabel != null) {
          cands.push({ price: correctionS.targetPrice, label: correctionS.targetLabel });
          cands.sort((a, b) => a.price - b.price);
        }
        if (edInC) {
          correctionS.text += ` · ⚡ Ending Diagonal in C erkannt (DG-1) – terminales Muster, erhöhtes Abwärts-Risiko`;
        }
      }

      if (correctionS && legsS.aDate != null && legsS.bDate != null) {
        const durA = daysBetweenE(w5.date, legsS.aDate);
        if (durA > 0) {
          const fromD = addDaysE(legsS.bDate, 0.618 * durA);
          const toD = addDaysE(legsS.bDate, 1.618 * durA);
          if (toD >= candles[candles.length - 1].date) {
            chartTimeWindows.push({ start: fromD, end: toD, label: "C-Fenster 0.618–1.618×A" });
            correctionS.text += ` · C-Zeitfenster ${fromD} – ${toD}`;
          }
        }
      }

      const tolPct = Math.max(3.5, Math.min(7, weeklyAtrPct(candles)));
      const clusters = clusterLevels(cands, tolPct);
      const underfoot = cands
        .map((c) => c.price)
        .filter((p) => p < currentPrice * 0.99)
        .sort((a, b) => b - a)[0] ?? null;

      chartClusters = clusters.slice(0, 8).map((cl) => ({
        floor: cl.floor, ceiling: cl.ceiling, score: cl.score, labels: cl.labels,
      }));
      if (underfoot != null) chartMarkers.push({ price: underfoot, label: "Trigger" });

      const inRangeS = (cl: { floor: number; ceiling: number }): boolean =>
        currentPrice >= cl.floor * 0.97 && currentPrice <= cl.ceiling * 1.03;
      const baselineZoneS = clusters.find((cl) => cl.score >= 2 && inRangeS(cl));
      const inZoneS = clusters.find((cl) => cl.score >= minClusterScore && inRangeS(cl));

      if (inZoneS && legsS.cHigh != null) {
        chartMarkers.push({ price: inZoneS.ceiling * 1.03, label: "Invalidierung" });
        const res = upsertPendingSetup(symbol, inZoneS, underfoot, legsS.cHigh, {
          llmConfidence: critique?.confidence ?? null,
          llmFlags: critique?.flags ?? [],
          detFlags: edInC ? [...quality.flags, "ED_IN_C_TERMINAL"] : quality.flags,
        }, "SHORT");
        pendingCreated = res === "created";
        clusterInfo =
          `🔴 **PENDING (SHORT)**: Kurs im Widerstands-Cluster ${inZoneS.floor.toFixed(2)}–${inZoneS.ceiling.toFixed(2)} ` +
          `(Score ${inZoneS.score}: ${inZoneS.labels.join(", ")}).\n` +
          `Trigger: Wochenschluss < ${underfoot != null ? underfoot.toFixed(2) : "n/a"} · ` +
          `Invalidierung: Wochenschluss > ${(inZoneS.ceiling * 1.03).toFixed(2)}` +
          (correctionS ? `\n${correctionS.text}` : "");
      } else {
        const above = clusters
          .filter((cl) => cl.score >= 2 && cl.floor > currentPrice)
          .sort((a, b) => a.floor - b.floor)[0] ??
          clusters.filter((cl) => cl.floor > currentPrice).sort((a, b) => a.floor - b.floor)[0];
        const gateNoteS =
          cautious && baselineZoneS
            ? `🛡️ Score-2-Zone ${baselineZoneS.floor.toFixed(2)}–${baselineZoneS.ceiling.toFixed(2)} übersprungen ` +
              `(Kritik: Confidence ${critique!.confidence}) – konservatives Gating verlangt Score ≥ 3.\n`
            : "";
        clusterInfo = gateNoteS + (above
          ? `⚪ Kein aktives Setup. Nächster Short-Cluster darüber: ${above.floor.toFixed(2)}–${above.ceiling.toFixed(2)} ` +
            `(Score ${above.score}: ${above.labels.join(", ")})` +
            (underfoot != null ? ` · Underfoot-Trigger: ${underfoot.toFixed(2)}` : "")
          : "⚪ Kein Widerstands-Cluster oberhalb des Kurses ableitbar.")
          + (correctionS ? `\n${correctionS.text}` : "");
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
          "INSERT INTO trade_history (symbol, signal_type, entry_price, invalidation, target, confidence, flags) VALUES (?, 'BREAKOUT', ?, ?, ?, ?, ?)"
        ).run(
          symbol, currentPrice, w2.price, target,
          critique?.confidence ?? null,
          JSON.stringify([...quality.flags, ...(critique?.flags ?? [])])
        );
      }
    }

    // 4. Kritik fuer die Anzeige formatieren (separate Telegram-Nachricht)
    const commentary = critique
      ? `Kritik (Confidence ${critique.confidence}%)` +
        (critique.flags.length > 0 ? `: ⚠️ ${critique.flags.join(", ")}` : "") +
        (critique.note ? ` — ${critique.note}` : "")
      : null;

    // 5. Chart: Impuls + Korrektur-Anhang + Engine-Level rendern
    const chartWaves: WavePoint[] = [...wc.points];
    if (legsS.aHigh != null && legsS.aDate != null) {
      chartWaves.push({ label: "A", date: legsS.aDate, price: legsS.aHigh });
      if (legsS.bLow != null && legsS.bDate != null) {
        chartWaves.push({ label: "B", date: legsS.bDate, price: legsS.bLow });
        if (legsS.cHigh != null && legsS.cDate != null && legsS.cHigh > legsS.bLow) {
          chartWaves.push({ label: "C", date: legsS.cDate, price: legsS.cHigh });
        }
      }
    }
    if (legs.aLow != null && legs.aDate != null) {
      chartWaves.push({ label: "A", date: legs.aDate, price: legs.aLow });
      if (legs.bHigh != null && legs.bDate != null) {
        chartWaves.push({ label: "B", date: legs.bDate, price: legs.bHigh });
        if (legs.cLow != null && legs.cDate != null && legs.cLow < legs.bHigh) {
          chartWaves.push({ label: "C", date: legs.cDate, price: legs.cLow });
        }
      }
    }

    if (completion && completion.projections.length > 0) {
      for (const pr of completion.projections) {
        chartMarkers.push({ price: pr.price, label: pr.label.split(" ")[0] });
      }
    }

    const buffer = await renderChart({
      symbol,
      waves: chartWaves,
      candles,
      clusters: chartClusters,
      markers: chartMarkers,
      timeWindows: chartTimeWindows.concat(completion ? completion.timeWindows : []),
    });

    // V118.1: Detail-Chart der W5-Binnenstruktur (Sub-Wellen bzw. ED-Keil).
    // Eigene Grafik, damit der Hauptchart nicht zu kleinteilig wird.
    let detailBuffer: Buffer | null = null;
    if (completion && completion.subPoints.length >= 2 && w4 && w5) {
      const subCandles = candles.filter((k) => k.date >= w4.date);
      const subWaves = completion.subPoints.map((sp) => ({
        label: completion.isDiagonal ? `${sp.label}` : `${sp.label}`,
        date: sp.date,
        price: sp.price,
      }));
      const subMarkers = completion.projections.map((pr) => ({
        price: pr.price,
        label: pr.label.split(" ")[0],
      }));
      const kind = completion.isDiagonal
        ? "Ending Diagonal"
        : completion.status === "IN_PROGRESS"
          ? `Welle 5 läuft – Sub-${completion.subLabel}`
          : "Welle 5 – Sub-5-Teiler";
      detailBuffer = await renderChart({
        symbol,
        waves: subWaves,
        candles: subCandles,
        markers: subMarkers,
        timeWindows: completion.timeWindows,
        titleSuffix: ` · ${kind} (ZigZag ${completion.subThreshold}%)`,
      });
    }

    return {
      buffer,
      signal: pendingCreated || isBreakoutSetup ? "YES" : "NO",
      finalTrend: wc.trend,
      pendingCreated,
      clusterInfo,
      isBreakoutSetup,
      breakoutStatus,
      analysis: wc,
      commentary,
      abstention: null,
      detailBuffer,
    };
  } catch (err: any) {
    console.error(`[ENGINE] Analysefehler ${symbol}:`, err?.message ?? err);
    return EMPTY;
  }
}
