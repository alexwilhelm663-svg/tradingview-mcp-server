import { fetchMarketData } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { measureContinuity } from "./continuity";
import { zigzag } from "./zigzag";

/**
 * V155: Automatische Rahmen-Kaskade.
 *
 * Die Engine analysiert nur den Rahmen, den der Nutzer angibt. Ein Titel, der
 * im Wochenbild schweigt, aber im Tagesbild sauber zaehlbar ist, faellt durchs
 * Raster - gemessen betrifft das 12 von 20 Titeln (ALAB und LCID nur taeglich,
 * AMZN nur woechentlich, TSLA/AAPL/PYPL nur in bestimmten Fenstern).
 *
 * Die Kaskade probiert weitere Rahmen und meldet, wo eine bessere Zaehlung
 * liegt. Sie ERSETZT den angeforderten Rahmen nicht - der Nutzer hat ihn
 * bewusst gewaehlt und die Lesart ist gradabhaengig (Regelwerk v5.0). Sie
 * weist nur den Weg.
 */

export interface FrameHit {
  interval: string;
  range: string;
  score: number;
  maxScore: number;
  doctrine: boolean;
  ratio: number | null; // Kontinuitaet
  quality: number;      // score/maxScore
}

export interface CascadeRead {
  hits: FrameHit[];
  best: FrameHit | null;
  note: string | null;
}

const FRAMES: { interval: string; range: string }[] = [
  { interval: "1wk", range: "5y" },
  { interval: "1wk", range: "max" },
  { interval: "1d", range: "2y" },
  { interval: "1d", range: "1y" },
];

async function probe(symbol: string, interval: string, range: string): Promise<FrameHit | null> {
  try {
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol, interval, range);
    if (!candles || candles.length < 40) return null;
    const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
    if (!outcome.impulse) return null;
    const res = outcome.impulse.result;
    const cont = measureContinuity(zigzag(candles, outcome.impulse.threshold), res.count);
    return {
      interval, range,
      score: res.score,
      maxScore: res.maxScore,
      doctrine: res.doctrineAnchor,
      ratio: cont ? cont.ratio : null,
      quality: res.maxScore > 0 ? res.score / res.maxScore : 0,
    };
  } catch {
    return null;
  }
}

/**
 * @param currentInterval  bereits analysierter Rahmen (wird uebersprungen)
 * @param currentQuality   dessen Guete (score/maxScore), null bei Enthaltung
 */
export async function runCascade(
  symbol: string,
  currentInterval: string,
  currentRange: string,
  currentQuality: number | null
): Promise<CascadeRead> {
  const hits: FrameHit[] = [];
  for (const f of FRAMES) {
    if (f.interval === currentInterval && f.range === currentRange) continue;
    const h = await probe(symbol, f.interval, f.range);
    if (h) hits.push(h);
  }
  if (hits.length === 0) {
    return {
      hits, best: null,
      note: currentQuality === null
        ? "🔎 Kaskade: auch in anderen Rahmen keine belastbare Zählung."
        : null,
    };
  }
  // Beste: hoechste Guete, bei Gleichstand durchgehendere Zaehlung
  hits.sort((a, b) =>
    b.quality !== a.quality ? b.quality - a.quality : (a.ratio ?? 1) - (b.ratio ?? 1)
  );
  const best = hits[0];

  let note: string | null = null;
  if (currentQuality === null) {
    // Aktueller Rahmen stumm -> jeder Treffer ist ein Gewinn
    note =
      `🔎 Kaskade: zählbar in ${best.interval}/${best.range} ` +
      `(Score ${best.score}/${best.maxScore}${best.doctrine ? ", Doktrin" : ", Fallback"})` +
      (hits.length > 1 ? ` · ${hits.length} Rahmen geprüft` : "");
  } else if (best.quality > currentQuality + 0.15) {
    // Deutlich besser (mind. 15 Prozentpunkte Guete)
    note =
      `🔎 Kaskade: ${best.interval}/${best.range} zählt klarer ` +
      `(Score ${best.score}/${best.maxScore} statt ${(currentQuality * 100).toFixed(0)} %)`;
  }
  return { hits, best, note };
}
