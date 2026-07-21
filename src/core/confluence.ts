import type { Candle } from "./marketData";
import { fetchMarketData } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { assessCompletion } from "./completion";

export type ConfluenceVerdict = "BESTÄTIGT" | "NEUTRAL" | "FRÜHWARNUNG";

export interface ConfluenceRead {
  verdict: ConfluenceVerdict;
  note: string; // eine kompakte Zeile für den Detail-Block
}

/**
 * V132: Stille Multi-Timeframe-Validierung (Woche -> Tag).
 *
 * Prüft, ob die aktuell laufende Welle der HAUPTEBENE sich auf der
 * tieferen Ebene sauber in ihre erwartete Substruktur zerlegen lässt.
 * Es wird KEINE eigene Zählung ausgegeben - nur ein Konfluenz-Verdikt.
 *
 * Konfluenz-Logik (verschachtelt):
 *  - Hauptebene "Welle 5 läuft" -> Tagesebene sollte darin einen
 *    gleichgerichteten, sich entwickelnden Impuls zeigen.
 *  - Hauptebene "Korrektur läuft" -> Tagesebene sollte einen
 *    GEGENläufigen Impuls zeigen (Korrektur oben = Impuls unten).
 *  - Zeigt die Tagesebene das Gegenteil (z.B. bestätigten Umschlag,
 *    den die Wochenebene noch nicht sieht) -> FRÜHWARNUNG.
 *
 * @param mainTrend      Trend der Hauptebene ("bullish"|"bearish")
 * @param mainPhase      "IMPULS" (W5 läuft) | "KORREKTUR"
 * @param symbol         Ticker (für den tieferen Fetch)
 * @param deeperInterval Intervall der tieferen Ebene (Default 1d)
 * @param deeperRange    Range der tieferen Ebene (Default 1y)
 */
export async function assessConfluence(
  mainTrend: "bullish" | "bearish",
  mainPhase: "IMPULS" | "KORREKTUR",
  symbol: string,
  deeperInterval = "1d",
  deeperRange = "1y"
): Promise<ConfluenceRead> {
  let cDeep: Candle[];
  try {
    const res = await fetchMarketData(symbol, deeperInterval, deeperRange);
    cDeep = res.weeklyAnalysisCandles;
  } catch {
    return { verdict: "NEUTRAL", note: "Sub-Ebene (Tag) nicht abrufbar – keine Konfluenz-Prüfung." };
  }
  if (!cDeep || cDeep.length < 30) {
    return { verdict: "NEUTRAL", note: "Sub-Ebene (Tag): zu wenige Kerzen für belastbare Konfluenz." };
  }

  const oDeep = findImpulseAdaptive(cDeep);
  if (!oDeep.impulse) {
    return {
      verdict: "NEUTRAL",
      note: "Sub-Ebene (Tag): keine klare Zählung – Konfluenz unbestimmt.",
    };
  }
  const deepTrend = oDeep.impulse.result.count.trend;
  const deepCompletion = assessCompletion(cDeep, oDeep.impulse.result.count, oDeep.impulse.threshold);

  // Erwartete Sub-Trend-Richtung je Hauptphase:
  // - IMPULS (W5 der Hauptebene läuft): Sub-Trend == Haupt-Trend (gleichgerichtet)
  // - KORREKTUR: Sub-Trend == Gegenrichtung (gegenläufiger Impuls)
  const expectedDeep: "bullish" | "bearish" =
    mainPhase === "IMPULS"
      ? mainTrend
      : mainTrend === "bullish"
        ? "bearish"
        : "bullish";

  const aligned = deepTrend === expectedDeep;

  if (mainPhase === "IMPULS") {
    if (aligned) {
      const sub =
        deepCompletion && deepCompletion.status === "IN_PROGRESS"
          ? ` (Tages-Impuls bei Sub-${deepCompletion.subLabel})`
          : "";
      return {
        verdict: "BESTÄTIGT",
        note: `Sub-Ebene (Tag) bestätigt: laufende Welle 5 zeigt gleichgerichteten Tages-Impuls${sub}.`,
      };
    }
    return {
      verdict: "FRÜHWARNUNG",
      note: `Sub-Ebene (Tag) läuft GEGEN die Hauptrichtung – Welle 5 evtl. bereits beendet, Korrektur könnte begonnen haben.`,
    };
  }

  // Hauptphase KORREKTUR
  if (aligned) {
    return {
      verdict: "BESTÄTIGT",
      note: `Sub-Ebene (Tag) bestätigt Korrektur: gegenläufiger Tages-Impuls im Gang (Korrektur oben = Impuls unten).`,
    };
  }
  // Sub-Trend läuft in HAUPT-Trendrichtung -> Korrektur evtl. vorbei,
  // Haupttrend nimmt wieder Fahrt auf (Frühwarnung auf Trendfortsetzung).
  return {
    verdict: "FRÜHWARNUNG",
    note: `Sub-Ebene (Tag) dreht in Haupt-Trendrichtung – Korrektur evtl. abgeschlossen, Trendfortsetzung voraus.`,
  };
}
