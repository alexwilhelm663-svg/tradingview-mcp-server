import { fetchMarketData, Candle } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { assessMultiWave } from "./multiWave";
import { renderChart } from "./chart";
import { zigzag } from "./zigzag";

/**
 * V161: Eigener Setup-Chart fuer die 1-2-Staffelung.
 *
 * Der Hauptchart trug zuletzt sechs Ebenen (0-5, A-B-C, Sub-Zaehlungen,
 * Zyklus-Skelett, Binnenstruktur, 1-2) und war unlesbar. Die 1-2-Struktur
 * bekommt daher ein eigenes Bild - und zwar auf 30-Minuten-Basis, weil sie
 * dort ueberhaupt erst sauber aufgeloest wird: auf Wochenkerzen verschwinden
 * Beine von 5-15 % im Rauschen (gemessen v6.9).
 *
 * Das Bild zeigt NUR: Kerzen + die 1-2-Punkte + die nachziehende Marke.
 */

export interface SetupChartResult {
  buffer: Buffer | null;
  caption: string;
}

export async function buildSetupChart(
  symbol: string,
  interval = "30m",
  range = "60d"
): Promise<SetupChartResult> {
  // V168: Range-Fallback. Yahoo liefert 1h bis 730 Tage, aber nicht fuer
  // jeden Titel (ALAB wirft dort 422). Statt abzubrechen wird das Fenster
  // schrittweise verkleinert.
  const ranges = [range, ...(interval === "1h" ? ["730d", "60d"] : ["60d", "1mo"])]
    .filter((r, i, arr) => arr.indexOf(r) === i);
  let candles: Candle[] | null = null;
  let usedRange = range;
  for (const rg of ranges) {
    try {
      const r = await fetchMarketData(symbol, interval, rg);
      if (r.weeklyAnalysisCandles && r.weeklyAnalysisCandles.length >= 60) {
        candles = r.weeklyAnalysisCandles;
        usedRange = rg;
        break;
      }
    } catch {
      /* naechstes Fenster */
    }
  }
  if (!candles) {
    return { buffer: null, caption: `❌ ${symbol}: keine ausreichenden ${interval}-Daten.` };
  }
  range = usedRange;
  const price = candles[candles.length - 1].close;

  // Anker: Extrem der jueingeren Vergangenheit. Auf 30-Minuten-Basis ist die
  // Welle 5 der Tages-/Wochenzaehlung meist ausserhalb des Fensters, daher
  // wird hier eigenstaendig gezaehlt.
  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
  let anchorDate: string;
  let anchorPrice: number;
  let dirCounter: 1 | -1;
  let threshold = 8;

  if (outcome.impulse) {
    const w5 = outcome.impulse.result.count.points.find((p) => p.label === "5");
    threshold = outcome.impulse.threshold;
    if (w5) {
      anchorDate = w5.date;
      anchorPrice = w5.price;
      dirCounter = outcome.impulse.result.count.trend === "bullish" ? -1 : 1;
    } else {
      return { buffer: null, caption: `❌ ${symbol}: unvollständige Zählung auf ${interval}.` };
    }
  } else {
    // Ohne Zaehlung: tiefstes Tief bzw. hoechstes Hoch des Fensters als Anker
    let lo = candles[0], hi = candles[0];
    for (const k of candles) {
      if (k.low < lo.low) lo = k;
      if (k.high > hi.high) hi = k;
    }
    const upFromLow = price > (lo.low + hi.high) / 2;
    anchorDate = upFromLow ? lo.date : hi.date;
    anchorPrice = upFromLow ? lo.low : hi.high;
    dirCounter = upFromLow ? 1 : -1;
  }

  const mw = assessMultiWave(candles, anchorDate, anchorPrice, dirCounter, threshold);
  if (!mw.note || mw.points.length < 3) {
    const piv = zigzag(candles, 4).length;
    // Auf 30 Minuten reicht das Fenster nur ~60 Tage zurueck. Eine Struktur,
    // die sich ueber Monate aufgebaut hat, liegt dann teilweise davor - der
    // Hinweis auf die Tagesebene verhindert den Fehlschluss "gibt es nicht".
    let hint = "";
    try {
      const day = await fetchMarketData(symbol, "1d", "2y");
      const dOut = findImpulseAdaptive(day.weeklyAnalysisCandles, (r) =>
        checkProportion(day.weeklyAnalysisCandles, r.count).ok
      );
      if (dOut.impulse) {
        const dW5 = dOut.impulse.result.count.points.find((p) => p.label === "5");
        if (dW5) {
          const dDir: 1 | -1 = dOut.impulse.result.count.trend === "bullish" ? -1 : 1;
          const dMw = assessMultiWave(
            day.weeklyAnalysisCandles, dW5.date, dW5.price, dDir, dOut.impulse.threshold
          );
          if (dMw.note) hint = `\nAuf Tagesbasis: ${dMw.note}`;
        }
      }
    } catch {
      /* best effort */
    }
    return {
      buffer: null,
      caption:
        `🔍 **${symbol}** · ${interval} · keine belastbare 1-2-Struktur\n` +
        `Anker ${anchorPrice.toFixed(2)} (${anchorDate.slice(0, 10)}) · ${candles.length} Kerzen · ${piv} Pivots` +
        hint,
    };
  }

  const marke = mw.currentInvalidation;
  const buffer = await renderChart({
    symbol: `${symbol} · ${interval} · 1-2-Struktur`,
    waves: [],
    candles,
    candlestick: true,
    multiWave: mw.points,
    markers: marke != null ? [{ price: marke, label: `Marke ${marke.toFixed(2)}` }] : [],
  });

  const dist = marke != null ? ((price / marke - 1) * 100).toFixed(1) : "-";
  const caption =
    `🔍 **${symbol}** · ${interval} · ${mw.note}\n` +
    `Kurs ${price.toFixed(2)} · Abstand zur Marke ${dist} %` +
    (mw.intact ? "" : " · ⚠️ gebrochen");
  return { buffer, caption };
}
