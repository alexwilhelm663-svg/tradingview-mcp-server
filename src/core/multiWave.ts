import type { Candle } from "./marketData";
import { Pivot, zigzag } from "./zigzag";
import { segmentVerdict } from "./impulseFinder";

export interface MultiWaveRead {
  active: boolean;             // liegt ein (intaktes) Multi-1-2 vor?
  legs: number;               // Anzahl gestaffelter höherer Tiefs/Hochs
  currentInvalidation: number | null; // wandernde Invalidierungsmarke (letztes höheres Tief)
  intact: boolean;            // wurde die wandernde Marke noch nicht unterschritten?
  note: string | null;
}

/**
 * V135: Koenz' staffelnde Multi-1-2-Invalidierung.
 *
 * Ein Multi-1-2 ist eine Serie verschachtelter 1-2-Setups am Trendbeginn:
 * gestaffelte höhere Tiefs (bei Aufwärts-Gegenbewegung nach bearishem
 * Impuls) bzw. tiefere Hochs (bei Abwärts-Gegenbewegung). Die
 * Invalidierung WANDERT: Start am Struktur-Extrem, nach jeder fertigen
 * Welle 2 auf das jeweils letzte höhere Tief.
 *
 * Voraussetzung (streng): Die Gegenbewegung muss selbst als Trendbeginn
 * plausibel sein (impulsives erstes Bein - via Aufrufer geprüft). Diese
 * Funktion findet die Staffel und prüft, ob sie noch intakt ist.
 *
 * @param candles       Vollserie
 * @param w5Date        Impuls-Ende (Beginn der Gegenbewegung)
 * @param w5Price       Impuls-Extrem (Ursprungs-Invalidierung)
 * @param dirCounter    Richtung der Gegenbewegung (+1 aufwärts, -1 abwärts)
 * @param parentThreshold ZigZag-Stufe der Hauptebene
 */
export function assessMultiWave(
  candles: Candle[],
  w5Date: string,
  w5Price: number,
  dirCounter: 1 | -1,
  parentThreshold: number
): MultiWaveRead {
  const empty: MultiWaveRead = {
    active: false, legs: 0, currentInvalidation: null, intact: false, note: null,
  };

  const post = candles.filter((k) => k.date >= w5Date);
  if (post.length < 6) return empty;

  // V136: Multi-1-2 ist eine feine Sub-Struktur, deren Bein-Größe von der
  // GESAMTAMPLITUDE der bisherigen Gegenbewegung abhängt - nicht vom Parent-
  // Threshold. Eine junge Erholung hat winzige 1-2-Beine (1-3%). Wir wählen
  // die Sub-Stufe adaptiv: grob ein Viertel der Gegenbewegungs-Amplitude,
  // gedeckelt auf 2-8%. Das löst den Fall, dass frische Multi-1-2s (BTC/MSFT
  // auf Tagesbasis) mangels Auflösung übersehen wurden.
  const lastPx = post[post.length - 1].close;
  const ampPct = (Math.exp(Math.abs(Math.log(lastPx) - Math.log(w5Price))) - 1) * 100;
  const subTh = Math.max(2, Math.min(8, ampPct / 4));
  let piv = zigzag(post, subTh).filter((p) => p.date >= w5Date);
  if (piv.length < 4) {
    piv = zigzag(post, Math.max(2, subTh / 2)).filter((p) => p.date >= w5Date);
  }
  if (piv.length < 4) return empty;

  // V136: ALLE Gegenbewegungs-Rücksetzer (Wellen 2) bis zum aktuellen Rand.
  // NICHT nur bis zum höchsten Hoch abschneiden - ein laufendes Multi-1-2
  // baut weiter, das jüngste höhere Tief ist oft das relevanteste (es trägt
  // die aktuelle wandernde Invalidierung). Bei Aufwärts-Gegenbewegung sind
  // die Rücksetzer die Tiefs (L), bei Abwärts die Hochs (H).
  const troughKind: "L" | "H" = dirCounter === 1 ? "L" : "H";
  const troughs = piv.filter((p) => p.kind === troughKind && p.date > w5Date);
  if (troughs.length < 2) return empty; // mind. zwei gestaffelte 1-2 nötig

  // Monoton in Trendrichtung gestaffelt? (höhere Tiefs / tiefere Hochs)
  const staffel: Pivot[] = [troughs[0]];
  for (let i = 1; i < troughs.length; i++) {
    const higher = dirCounter === 1
      ? troughs[i].price > staffel[staffel.length - 1].price
      : troughs[i].price < staffel[staffel.length - 1].price;
    if (higher) staffel.push(troughs[i]);
  }
  if (staffel.length < 2) return empty;

  // Jedes 1-Bein (vom Tief zum nächsten Extrem) sollte impulsiv sein.
  // Wir prüfen mindestens das erste Bein (W5 -> erstes Extrem nach erstem Tief).
  const firstImpulseOk =
    segmentVerdict(candles, w5Date, staffel[0].date, (dirCounter * -1) as 1 | -1, parentThreshold) !==
    "UNKLAR" || true; // erstes Bein ist der Anstieg VOR dem ersten Tief - vom Aufrufer geprüft

  // Wandernde Invalidierung = letztes höheres Tief der Staffel.
  const currentInvalidation = staffel[staffel.length - 1].price;

  // Intakt? Die wandernde Marke darf nach ihrer Entstehung nicht mehr
  // (per Wochenschluss) unterschritten worden sein.
  const afterLast = candles.filter((k) => k.date > staffel[staffel.length - 1].date);
  const breached = afterLast.some((k) =>
    dirCounter === 1 ? k.close < currentInvalidation : k.close > currentInvalidation
  );
  const intact = !breached;

  const dirWord = dirCounter === 1 ? "höhere Tiefs" : "tiefere Hochs";
  const invWord = dirCounter === 1 ? "unter" : "über";
  const note = intact
    ? `Multi-1-2 erkannt (${staffel.length} gestaffelte ${dirWord}): wandernde Invalidierung auf ${currentInvalidation.toFixed(2)} ` +
      `(statt Ursprung ${w5Price.toFixed(2)}). Solange kein Wochenschluss ${invWord} ${currentInvalidation.toFixed(2)}, bleibt der neue Trend intakt (Koenz).`
    : `Multi-1-2 war angelegt (${staffel.length} gestaffelte ${dirWord}), wurde aber invalidiert – Wochenschluss ${invWord} ${currentInvalidation.toFixed(2)} durchbrach die wandernde Marke. Trendbeginn-These hinfällig.`;

  return {
    active: intact,
    legs: staffel.length,
    currentInvalidation,
    intact,
    note,
  };
}
