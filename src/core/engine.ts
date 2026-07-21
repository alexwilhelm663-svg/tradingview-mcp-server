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
import { assessCompletion, CompletionRead } from "./completion";
import { findBestImpulse, subThresholds } from "./impulseFinder";
import { zigzag } from "./zigzag";
import { assessQuality } from "./quality";

export interface AnalysisResult {
  buffer: Buffer | null;
  signal: "YES" | "NO";
  finalTrend: string;
  bigPicture: string;
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
  bigPicture: "",
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
  // V128: ERSTE A-B-C-Sequenz. A = erstes markantes Tief nach dem Top
  // (die Pivots sind bereits ZigZag-gefiltert, also KEINE Ein-Wochen-Dips
  // mehr - das entschaerft den alten V112-Bug ohne globale Extrema zu
  // erzwingen, die ganze Auf-Ab-Zyklen zusammenpressen). B = erstes Hoch
  // nach A; C = erstes Tief nach B (Ende der ersten Dreier-Struktur).
  const aPivot = lows[0]; // erstes markantes Tief = A
  const bCandidates = highs.filter((p) => p.date > aPivot.date);
  if (bCandidates.length === 0) {
    return { ...empty, aLow: aPivot.price, aDate: aPivot.date };
  }
  const bPivot = bCandidates[0]; // erstes Hoch nach A = B
  const cCandidatesPiv = lows.filter((p) => p.date > bPivot.date);
  let cLow: number | null = null;
  let cDate: string | null = null;
  if (cCandidatesPiv.length > 0) {
    cLow = cCandidatesPiv[0].price;
    cDate = cCandidatesPiv[0].date;
  } else {
    const afterB = candles.filter((k) => k.date > bPivot.date);
    for (const k of afterB) {
      if (cLow === null || k.low < cLow) { cLow = k.low; cDate = k.date; }
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
  // V128: ERSTE A-B-C-Sequenz statt globaler Extrema. A = erstes markantes
  // Hoch nach W5; B = erstes Tief danach; C = nächstes Hoch (Ende der ersten
  // Dreier-Struktur). Das alte "B = global tiefstes Tief" presste ganze
  // Auf-Ab-Zyklen in ein A-B und segmentierte die Struktur falsch (CRCL:
  // A=136 → B=58 statt A=136 → B=84 → C=140).
  const aPivot = highs[0]; // erstes Hoch = A
  const bCandidates = lows.filter((p) => p.date > aPivot.date);
  if (bCandidates.length === 0) {
    return { ...empty, aHigh: aPivot.price, aDate: aPivot.date };
  }
  const bPivot = bCandidates[0]; // erstes Tief nach A = B
  const cCandidatesPiv = highs.filter((p) => p.date > bPivot.date);
  let cHigh: number | null = null;
  let cDate: string | null = null;
  if (cCandidatesPiv.length > 0) {
    cHigh = cCandidatesPiv[0].price;
    cDate = cCandidatesPiv[0].date;
  } else {
    const afterB = candles.filter((k) => k.date > bPivot.date);
    for (const k of afterB) {
      if (cHigh === null || k.high > cHigh) { cHigh = k.high; cDate = k.date; }
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

export async function analyzeAsset(symbol: string, range: string = "5y", interval: string = "1wk"): Promise<AnalysisResult> {
  try {
    // 1. Marktdaten (Weekly, 5 Jahre) + deterministische Pivots
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol, interval, range);
    const currentPrice = candles[candles.length - 1].close;

    // 2. Deterministische Impulszaehlung (V113.1) mit Enthaltungs-Gebot (DK-7)
    const outcome = findImpulseAdaptive(candles);
    if (outcome.impulse === null) {
      console.log(`[ENGINE] ${symbol}: Enthaltung (DK-7) - ${outcome.abstention}`);
      const buffer = await renderChart({ symbol, waves: [], candles, candlestick: interval === "1d" });
      return { ...EMPTY, buffer, abstention: outcome.abstention };
    }
    const { result: impulse, pivots, threshold } = outcome.impulse;
    const wc = impulse.count;

    // 2b. Deterministische Qualitaets-Checks (V114 Stufe 1):
    // Divergenz + Subwellen-Struktur erweitern den Score, Negativbefunde werden Flags.
    const quality = assessQuality(candles, wc, threshold);
    wc.analysis += ` · ${quality.summary}`;

    // V118 (DK-9): Ist Welle 5 wirklich fertig - oder laeuft der Impuls noch?
    // V127: DK-9 (Vollendungs-Nachweis) darf nur greifen, solange KEINE
    // Korrektur ab W5 ausgebildet ist. Bewegt sich der Kurs bereits von W5
    // weg und es existiert eine A-B-C/W-X-Y-Struktur, IST Welle 5 fertig -
    // sonst widerspricht sich die Analyse (Chart zeigt fertige 5 + laufende
    // Korrektur, Text behauptet "5 läuft noch"). Wird nach der Korrektur-
    // Bestimmung final entschieden.
    let completion: CompletionRead | null = assessCompletion(candles, wc, threshold);
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
    // V121: Score>=3-Gate. Walk-Forward (8 Sym., 10 J.): Score>=3 traegt
    // ~5x die Expectancy von Score 2 (10.7% vs 2.4%). Score-2-Zonen werden
    // nur noch als WATCH gemeldet. Kritik-Asymmetrie bleibt informativ.
    const minClusterScore = 3;

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
    let scenPrimary = "";
    let scenAlt = "";
    let keyLine = "";
    let correction: CorrectionRead | null = null;
    let correctionS: CorrectionRead | null = null;
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

      // Terminales Muster -> rein informativ + Flag (DK-6: nie Trigger-lockernd).
      // V115 (KO-2/3/4): Korrektur-Lesart + musterabhaengiges C-Ziel
      if (legs.aLow != null && legs.bHigh != null) {
        correction = classifyCorrection(
          w5.price, legs.aLow, legs.bHigh, legs.cLow, currentPrice,
          pivots.filter((pv) => pv.date > w5.date)
        , 1,
          { candles, parentThreshold: threshold, topDate: w5.date, aDate: legs.aDate, bDate: legs.bDate,
            impulseOrigin: w0?.price ?? null, impulseEnd: w5.price }
        );
        if (correction.targetPrice != null && correction.targetLabel != null) {
          cands.push({ price: correction.targetPrice, label: correction.targetLabel });
          cands.sort((a, b) => a.price - b.price);
        }
      }
      // ATR-adaptive Toleranz (Skill-Prinzip): 3.5%..7%, je nach Volatilitaet
      // V120b/V121: Zeitfenster des C-Endes (Koenz, 0.618-1.618 Fib-Zeit
      // von A ab B-Ende) - jetzt auch als GATE fuer neue PENDINGs.
      let cWinFrom: string | null = null;
      let cWinTo: string | null = null;
      if (correction && legs.aDate != null && legs.bDate != null) {
        const durA = daysBetweenE(w5.date, legs.aDate);
        if (durA > 0) {
          cWinFrom = addDaysE(legs.bDate, 0.618 * durA);
          cWinTo = addDaysE(legs.bDate, 1.618 * durA);
          if (cWinTo >= candles[candles.length - 1].date) {
            chartTimeWindows.push({ start: cWinFrom, end: cWinTo, label: "C-Fenster 0.618–1.618×A" });
            correction.text += ` · C-Zeitfenster ${cWinFrom} – ${cWinTo}`;
          }
        }
      }
      const lastDate = candles[candles.length - 1].date;
      const inTimeWindow =
        cWinFrom == null || cWinTo == null || (lastDate >= cWinFrom && lastDate <= cWinTo);

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
          detFlags: quality.flags,
        });
        pendingCreated = res === "created";
        clusterInfo =
          `🟡 **PENDING**: Kurs im Fib-Cluster ${inZone.floor.toFixed(2)}–${inZone.ceiling.toFixed(2)} ` +
          `(Score ${inZone.score}: ${inZone.labels.join(", ")}).\n` +
          `Trigger: Wochenschluss > ${overhead != null ? overhead.toFixed(2) : "n/a"} · ` +
          `Invalidierung: Wochenschluss < ${(inZone.floor * 0.97).toFixed(2)}` +
          (cWinFrom != null
            ? ` · ⏱️ ${inTimeWindow ? "im" : "außerhalb des"} C-Zeitfensters (${cWinFrom} – ${cWinTo})`
            : "") +
          (correction ? `\n${correction.text}` : "");
        {
          const tPrev = overhead != null ? overhead + 1.618 * (overhead - legs.cLow) : null;
          scenPrimary =
            `Boden-These: Wochenschluss > ${overhead != null ? overhead.toFixed(2) : "Trigger"} bestätigt das Long-Setup` +
            (tPrev != null ? ` – Ziel ~${tPrev.toFixed(2)} (1.618·i)` : "") + ".";
          scenAlt =
            `Wochenschluss < ${(inZone.floor * 0.97).toFixed(2)} invalidiert – Korrektur läuft tiefer` +
            (correction && correction.targetPrice != null ? ` Richtung ${correction.targetPrice.toFixed(2)}` : "") + ".";
          keyLine = `Zone ${inZone.floor.toFixed(2)}–${inZone.ceiling.toFixed(2)} · Trigger ${overhead != null ? overhead.toFixed(2) : "–"} · Invalidierung ${(inZone.floor * 0.97).toFixed(2)}`;
        }
      } else {
        const below = clusters
          .filter((cl) => cl.score >= 2 && cl.ceiling < currentPrice)
          .sort((a, b) => b.ceiling - a.ceiling)[0] ??
          clusters.filter((cl) => cl.ceiling < currentPrice).sort((a, b) => b.ceiling - a.ceiling)[0];
        const gateNote =
          baselineZone && !inZone
            ? `🟡 WATCH: Score-2-Zone ${baselineZone.floor.toFixed(2)}–${baselineZone.ceiling.toFixed(2)} berührt – ` +
              `kein Setup (Gate: Score ≥ 3, V121-Messung: 10.7% vs 2.4% Expectancy).\n`
            : "";
        clusterInfo = gateNote + (below
          ? `⚪ Kein aktives Setup. Nächster Long-Cluster darunter: ${below.floor.toFixed(2)}–${below.ceiling.toFixed(2)} ` +
            `(Score ${below.score}: ${below.labels.join(", ")})` +
            (overhead != null ? ` · Overhead-Trigger: ${overhead.toFixed(2)}` : "")
          : "⚪ Kein Fib-Cluster unterhalb des Kurses ableitbar.")
          + (correction ? `\n${correction.text}` : "");
        scenPrimary = below
          ? `Korrektur aktiv – nächste Kaufzone ${below.floor.toFixed(2)}–${below.ceiling.toFixed(2)}` +
            (correction && correction.targetPrice != null ? `, präferiertes C-Ziel ${correction.targetPrice.toFixed(2)}` : "") + "."
          : "Korrektur aktiv – keine belastbare Kaufzone darunter ableitbar.";
        scenAlt = overhead != null
          ? `Rückeroberung > ${overhead.toFixed(2)} deutet auf Trend-Fortsetzung nach oben.`
          : "Rückeroberung des W4-Niveaus deutet auf Trend-Fortsetzung.";
        keyLine = below ? `Watch-Zone ${below.floor.toFixed(2)}–${below.ceiling.toFixed(2)}` : "";
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

      const cands = shortLevelCandidates({
        w0: w0.price,
        w5: w5.price,
        w4: w4?.price ?? null,
        aHigh: legsS.aHigh,
        bLow: legsS.bLow,
      });

      // correctionS auf Funktionsebene deklariert
      if (legsS.aHigh != null && legsS.bLow != null) {
        correctionS = classifyCorrection(
          w5.price, legsS.aHigh, legsS.bLow, legsS.cHigh, currentPrice,
          pivots.filter((pv) => pv.date > w5.date), -1,
          { candles, parentThreshold: threshold, topDate: w5.date, aDate: legsS.aDate, bDate: legsS.bDate,
            impulseOrigin: w0?.price ?? null, impulseEnd: w5.price }
        );
        if (correctionS.targetPrice != null && correctionS.targetLabel != null) {
          cands.push({ price: correctionS.targetPrice, label: correctionS.targetLabel });
          cands.sort((a, b) => a.price - b.price);
        }
      }

      let cWinFromS: string | null = null;
      let cWinToS: string | null = null;
      if (correctionS && legsS.aDate != null && legsS.bDate != null) {
        const durA = daysBetweenE(w5.date, legsS.aDate);
        if (durA > 0) {
          cWinFromS = addDaysE(legsS.bDate, 0.618 * durA);
          cWinToS = addDaysE(legsS.bDate, 1.618 * durA);
          if (cWinToS >= candles[candles.length - 1].date) {
            chartTimeWindows.push({ start: cWinFromS, end: cWinToS, label: "C-Fenster 0.618–1.618×A" });
            correctionS.text += ` · C-Zeitfenster ${cWinFromS} – ${cWinToS}`;
          }
        }
      }
      const lastDateS = candles[candles.length - 1].date;
      const inTimeWindowS =
        cWinFromS == null || cWinToS == null || (lastDateS >= cWinFromS && lastDateS <= cWinToS);

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
          detFlags: quality.flags,
        }, "SHORT");
        pendingCreated = res === "created";
        clusterInfo =
          `🔴 **PENDING (SHORT)**: Kurs im Widerstands-Cluster ${inZoneS.floor.toFixed(2)}–${inZoneS.ceiling.toFixed(2)} ` +
          `(Score ${inZoneS.score}: ${inZoneS.labels.join(", ")}).\n` +
          `Trigger: Wochenschluss < ${underfoot != null ? underfoot.toFixed(2) : "n/a"} · ` +
          `Invalidierung: Wochenschluss > ${(inZoneS.ceiling * 1.03).toFixed(2)}` +
          (cWinFromS != null
            ? ` · ⏱️ ${inTimeWindowS ? "im" : "außerhalb des"} C-Zeitfensters (${cWinFromS} – ${cWinToS})`
            : "") +
          (correctionS ? `\n${correctionS.text}` : "");
        {
          const tPrev = underfoot != null ? underfoot - 1.618 * (legsS.cHigh - underfoot) : null;
          scenPrimary =
            `Abwärts-Fortsetzung: Wochenschluss < ${underfoot != null ? underfoot.toFixed(2) : "Trigger"} bestätigt das Short-Setup` +
            (tPrev != null ? ` – Ziel ~${tPrev.toFixed(2)} (1.618·i)` : "") + ".";
          scenAlt =
            `Wochenschluss > ${(inZoneS.ceiling * 1.03).toFixed(2)} invalidiert – Boden ${w5.price.toFixed(2)} hält, Erholung` +
            (correctionS && correctionS.targetPrice != null ? ` Richtung ${correctionS.targetPrice.toFixed(2)}` : "") + " läuft weiter.";
          keyLine = `Zone ${inZoneS.floor.toFixed(2)}–${inZoneS.ceiling.toFixed(2)} · Trigger ${underfoot != null ? underfoot.toFixed(2) : "–"} · Invalidierung ${(inZoneS.ceiling * 1.03).toFixed(2)}`;
        }
      } else {
        const above = clusters
          .filter((cl) => cl.score >= 2 && cl.floor > currentPrice)
          .sort((a, b) => a.floor - b.floor)[0] ??
          clusters.filter((cl) => cl.floor > currentPrice).sort((a, b) => a.floor - b.floor)[0];
        const gateNoteS =
          baselineZoneS && !inZoneS
            ? `🟡 WATCH: Score-2-Zone ${baselineZoneS.floor.toFixed(2)}–${baselineZoneS.ceiling.toFixed(2)} berührt – ` +
              `kein Setup (Gate: Score ≥ 3, V121-Messung).\n`
            : "";
        clusterInfo = gateNoteS + (above
          ? `⚪ Kein aktives Setup. Nächster Short-Cluster darüber: ${above.floor.toFixed(2)}–${above.ceiling.toFixed(2)} ` +
            `(Score ${above.score}: ${above.labels.join(", ")})` +
            (underfoot != null ? ` · Underfoot-Trigger: ${underfoot.toFixed(2)}` : "")
          : "⚪ Kein Widerstands-Cluster oberhalb des Kurses ableitbar.")
          + (correctionS ? `\n${correctionS.text}` : "");
        scenPrimary = above
          ? `Erholung läuft – nächste Widerstandszone ${above.floor.toFixed(2)}–${above.ceiling.toFixed(2)}` +
            (correctionS && correctionS.targetPrice != null ? `, präferiertes C-Ziel ${correctionS.targetPrice.toFixed(2)}` : "") + "."
          : "Erholung läuft – keine belastbare Widerstandszone darüber ableitbar.";
        scenAlt = underfoot != null
          ? `Wochenschluss < ${underfoot.toFixed(2)} deutet auf Abwärts-Fortsetzung.`
          : "Bruch der Erholungstiefs deutet auf Abwärts-Fortsetzung.";
        keyLine = above ? `Watch-Zone ${above.floor.toFixed(2)}–${above.ceiling.toFixed(2)}` : "";
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
    if (correctionS && correctionS.legPoints.length > 0) {
      for (const lp of correctionS.legPoints) chartWaves.push(lp);
    } else if (legsS.aHigh != null && legsS.aDate != null) {
      chartWaves.push({ label: "A", date: legsS.aDate, price: legsS.aHigh });
      if (legsS.bLow != null && legsS.bDate != null) {
        chartWaves.push({ label: "B", date: legsS.bDate, price: legsS.bLow });
      }
    }
    if (correction && correction.legPoints.length > 0) {
      for (const lp of correction.legPoints) chartWaves.push(lp);
    } else if (legs.aLow != null && legs.aDate != null) {
      chartWaves.push({ label: "A", date: legs.aDate, price: legs.aLow });
      if (legs.bHigh != null && legs.bDate != null) {
        chartWaves.push({ label: "B", date: legs.bDate, price: legs.bHigh });
      }
    }

    if (completion && completion.projections.length > 0) {
      for (const pr of completion.projections) {
        chartMarkers.push({ price: pr.price, label: pr.label.split(" ")[0] });
      }
    }

    // V127: Widerspruch aufloesen - eine ausgebildete Korrektur ab W5
    // (>= A und B vorhanden) beweist, dass Welle 5 abgeschlossen ist.
    const koActive =
      (correction && correction.legPoints.length >= 2) ||
      (correctionS && correctionS.legPoints.length >= 2);
    if (koActive && completion && completion.status === "IN_PROGRESS") {
      completion = null; // DK-9 schweigt; die Korrektur-Lesart hat Vorrang
    }

    // V123: Sub-Zählungen (eine Stufe tiefer) fuer die Antriebswellen 1/3/5
    // direkt im Hauptchart - kleine roemische Labels (i-v) in Teal.
    const subwaves: WavePoint[] = [];
    const roman = ["", "i", "ii", "iii", "iv", "v"];
    const dirMain: 1 | -1 = wc.trend === "bullish" ? 1 : -1;
    for (const [fromL, toL] of [["0", "1"], ["2", "3"], ["4", "5"]] as const) {
      const a = wc.points.find((x) => x.label === fromL);
      const b = wc.points.find((x) => x.label === toL);
      if (!a || !b) continue;
      const seg = candles.filter((k) => k.date >= a.date && k.date <= b.date);
      if (seg.length < 15) continue;
      for (const th of subThresholds(threshold)) {
        const piv = zigzag(seg, th);
        if (piv.length < 6) continue;
        const sub = findBestImpulse(piv);
        if (!sub || sub.count.trend !== wc.trend) continue;
        for (const sp of sub.count.points) {
          const n = Number(sp.label);
          if (n >= 1 && n <= 5) subwaves.push({ label: roman[n], date: sp.date, price: sp.price });
        }
        break;
      }
    }

    // V122 (MCO-Stil): Big Picture - Kontext, zwei Szenarien, Schluessel-Level
    const yr = (d: string): string => d.slice(0, 4);
    const cyc =
      w0 && w5
        ? `${wc.trend === "bullish" ? "Aufwärts" : "Abwärts"}impuls ${w0.price.toFixed(0)} → ${w5.price.toFixed(0)} (${yr(w0.date)}–${yr(w5.date)})` +
          (completion
            ? completion.status === "COMPLETE"
              ? " – vollendet, Korrekturphase."
              : ` – Welle 5 läuft noch (Sub-${completion.subLabel}).`
            : ".")
        : "";
    const koRead = wc.trend === "bullish" ? correction : correctionS;
    let bigPicture = `🧭 **Big Picture:** ${cyc}`;
    if (koRead && koRead.pattern === "KOMBINATION")
      bigPicture += ` Korrektur läuft als **W-X-Y** (zusammengesetzt), nicht als einfache A-B-C – erfahrungsgemäß **tiefer** (0,618–0,786 statt ~0,5), Kaufzone entsprechend riskanter.`;
    if (koRead && koRead.reversalRisk === "CONFIRMED")
      bigPicture += `\n🔄 **Trendwechsel:** ${koRead.reversalNote}`;
    else if (koRead && koRead.reversalRisk === "LIKELY")
      bigPicture += `\n🔄 **Umschlag wahrscheinlich (A-B-C → 1-2):** ${koRead.reversalNote}`;
    else if (koRead && koRead.reversalRisk === "WATCH")
      bigPicture += `\n👁️ **Umschlag-Beobachtung:** ${koRead.reversalNote}`;
    if (scenPrimary) bigPicture += `\n1️⃣ **Primär:** ${scenPrimary}`;
    if (scenAlt) bigPicture += `\n2️⃣ **Alternativ:** ${scenAlt}`;
    if (keyLine) bigPicture += `\n📌 ${keyLine}`;
    const tw0 = chartTimeWindows[0];
    if (tw0) bigPicture += `\n⏱️ ${tw0.label}: ${tw0.start} – ${tw0.end}`;

    const buffer = await renderChart({
      symbol,
      waves: chartWaves,
      candles,
      clusters: chartClusters,
      markers: chartMarkers,
      timeWindows: chartTimeWindows.concat(completion ? completion.timeWindows : []),
      subwaves,
      candlestick: interval === "1d",
    });

    // V118.1: Detail-Chart der W5-Binnenstruktur (Sub-Wellen bzw. ED-Keil).
    // Eigene Grafik, damit der Hauptchart nicht zu kleinteilig wird.
    let detailBuffer: Buffer | null = null;
    if (completion && completion.subPoints.length >= 2 && w4 && w5) {
      const subCandles = candles.filter((k) => k.date >= w4.date);
      const subWaves = completion.subPoints.map((sp) => ({
        label: `${sp.label}`,
        date: sp.date,
        price: sp.price,
      }));
      const subMarkers = completion.projections.map((pr) => ({
        price: pr.price,
        label: pr.label.split(" ")[0],
      }));
      const kind =
        completion.status === "IN_PROGRESS"
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
      bigPicture,
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
