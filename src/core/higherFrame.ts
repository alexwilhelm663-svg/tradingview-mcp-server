import { fetchMarketData } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { assessMultiWave } from "./multiWave";
import { assessCompletion } from "./completion";

export interface HigherFrameRead {
  available: boolean;
  note: string; // kompakte übergeordnete Einordnung für den Report
}

/**
 * V137: Übergeordnete Einordnung ("Big Picture erzwingen").
 *
 * Bei einem klein gezoomten Ausschnitt (kurze Range / Enthaltung, weil kein
 * Impuls auf der Zoom-Stufe zählbar ist) zieht der Bot automatisch die
 * übergeordnete Ebene (5y, sonst max) hinzu und entscheidet, ob wir uns an
 * einem ÜBERGEORDNETEN Wendepunkt befinden:
 *  - Läuft dort ein Impuls, dessen Extrem gerade erreicht/überschritten wurde?
 *  - Baut die Gegenbewegung ab dem großen Extrem ein Multi-1-2 auf (Trend-
 *    wechsel im großen Grad)?
 *
 * Gibt eine kompakte Einordnung zurück - KEINE zweite Vollanalyse.
 *
 * @param symbol       Ticker
 * @param skipRange    Range, die bereits analysiert wurde (nicht wiederholen)
 */
export async function assessHigherFrame(
  symbol: string,
  skipRange: string
): Promise<HigherFrameRead> {
  // Übergeordnete Ebenen in Prioritätsreihenfolge; die bereits genutzte
  // (oder feinere) überspringen.
  const frames: Array<{ range: string; label: string }> = [
    { range: "5y", label: "5 Jahre" },
    { range: "max", label: "Maximum" },
  ];

  for (const fr of frames) {
    if (fr.range === skipRange) continue;
    let candles;
    try {
      const res = await fetchMarketData(symbol, "1wk", fr.range);
      candles = res.weeklyAnalysisCandles;
    } catch {
      continue;
    }
    if (!candles || candles.length < 30) continue;

    const outcome = findImpulseAdaptive(candles);
    if (!outcome.impulse) continue; // auch übergeordnet keine Zählung -> nächste Ebene

    const wc = outcome.impulse.result.count;
    const threshold = outcome.impulse.threshold;
    const w0 = wc.points.find((p) => p.label === "0");
    const w5 = wc.points.find((p) => p.label === "5");
    if (!w0 || !w5) continue;

    const trendWord = wc.trend === "bullish" ? "Aufwärts" : "Abwärts";
    const lastPx = candles[candles.length - 1].close;

    // Steht der Kurs am/jenseits des übergeordneten Extrems (Impuls vollendet)?
    const completion = assessCompletion(candles, wc, threshold);
    const impulseComplete = completion == null || completion.status === "COMPLETE";

    // Gegenbewegung ab dem großen Extrem: Multi-1-2-Trendwechsel im Großgrad?
    const dirCounter: 1 | -1 = wc.trend === "bearish" ? 1 : -1;
    const awayFromExtreme =
      wc.trend === "bearish" ? lastPx > w5.price : lastPx < w5.price;
    let mwNote = "";
    if (awayFromExtreme) {
      const mw = assessMultiWave(candles, w5.date, w5.price, dirCounter, threshold);
      if (mw.intact && mw.legs >= 3) {
        mwNote =
          ` Am übergeordneten Extrem (${w5.price.toFixed(2)}) baut sich ein Multi-1-2 auf ` +
          `(${mw.legs} gestaffelte ${dirCounter === 1 ? "höhere Tiefs" : "tiefere Hochs"}) – ` +
          `möglicher **übergeordneter Wendepunkt**. Wandernde Invalidierung: ${mw.currentInvalidation?.toFixed(2)}.`;
      }
    }

    const yr = (d: string) => d.slice(0, 4);
    const phase = awayFromExtreme
      ? impulseComplete
        ? "Impuls vollendet, Gegenbewegung läuft"
        : "Extrem erreicht, frühe Gegenbewegung"
      : "Impuls noch aktiv";

    const note =
      `📐 **Übergeordnet (${fr.label}, Wochen):** ${trendWord}impuls ` +
      `${w0.price.toFixed(2)} → ${w5.price.toFixed(2)} (${yr(w0.date)}–${yr(w5.date)}) – ${phase}.` +
      mwNote +
      (mwNote === "" && awayFromExtreme
        ? ` Noch kein bestätigtes Multi-1-2 am Extrem – Wendepunkt unbestätigt.`
        : "");

    return { available: true, note };
  }

  return {
    available: false,
    note: "📐 Übergeordnet: auch auf 5y/max keine regelkonforme Zählung – kein Big-Picture-Kontext ableitbar.",
  };
}
