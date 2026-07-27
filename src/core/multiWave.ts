import type { Candle } from "./marketData";
import { Pivot, zigzag } from "./zigzag";
import { segmentVerdict } from "./impulseFinder";

export interface MultiWaveRead {
  active: boolean;                    // echte Grad-Verschachtelung
  legs: number;                       // Anzahl vollstaendiger 1-2-Einheiten
  currentInvalidation: number | null; // nachziehende Marke = letztes Welle-2-Extrem
  intact: boolean;
  note: string | null;                // null = Schweigen
}

const EMPTY: MultiWaveRead = {
  active: false, legs: 0, currentInvalidation: null, intact: false, note: null,
};

// ── Belastbarkeits-Anforderungen (V144) ────────────────────────────────────
// Vorher genuegten drei gestaffelte Pivots auf einer Schwelle, die aus der
// Amplitude abgeleitet war - bei einer jungen Bewegung also Rauschen. Jetzt
// muss jede 1-2-Einheit einzeln belegt sein, sonst wird geschwiegen.
const MIN_LEG_LOG = 0.05;      // jede Welle 1 mind. ~5 %
const MIN_LEG_CANDLES = 4;     // keine Zwei-Kerzen-Wellen
const MIN_RETRACE = 0.236;     // Welle 2 muss wirklich korrigieren
const MAX_RETRACE = 0.90;      // ... aber die Welle 1 nicht aufloesen
const MIN_UNITS = 2;           // mind. zwei vollstaendige 1-2
const MAX_DEGREES = 4;
const NEST_SHRINK = 0.85;      // Verschachtelung: jede Welle 1 klar kleiner

interface Unit {
  startPrice: number; startDate: string;
  peakPrice: number;  peakDate: string;
  troughPrice: number; troughDate: string;
  legLog: number; retrace: number;
}

/**
 * V144: Strenge 1-2-Struktur-Erkennung.
 *
 * Es wird nur gemeldet, was Einheit fuer Einheit belegt ist:
 *  - jede Welle 1 mindestens 5 % gross und ueber mindestens 4 Kerzen,
 *  - jede Welle 2 korrigiert 23,6-90 % ihrer Welle 1,
 *  - die erste Welle 1 muss strukturell impulsiv sein (segmentVerdict),
 *  - mindestens zwei vollstaendige 1-2-Einheiten.
 * Faellt eine Bedingung, gibt es KEINE Meldung (Enthaltung statt Rauschen).
 *
 * Zusaetzlich Multi-1-2 (Verschachtelung) nur, wenn die Wellen-1 materiell
 * schrumpfen (<= 0,85x) und hoechstens vier Grade vorliegen.
 */
export function assessMultiWave(
  candles: Candle[],
  w5Date: string,
  w5Price: number,
  dirCounter: 1 | -1,
  parentThreshold: number
): MultiWaveRead {
  const post = candles.filter((k) => k.date >= w5Date);
  if (post.length < 12) return EMPTY;

  // Aufloesung an die Bewegung koppeln, aber nie unter 3 % - darunter zaehlt
  // der ZigZag Rauschen als Struktur.
  const lastPx = post[post.length - 1].close;
  const ampPct = (Math.exp(Math.abs(Math.log(lastPx) - Math.log(w5Price))) - 1) * 100;
  const subTh = Math.max(3, Math.min(8, ampPct / 4));
  const piv = zigzag(post, subTh).filter((p) => p.date > w5Date);
  if (piv.length < 3) return EMPTY;

  const peakKind: "H" | "L" = dirCounter === 1 ? "H" : "L";
  const troughKind: "H" | "L" = dirCounter === 1 ? "L" : "H";
  const beyond = (a: number, b: number) => (dirCounter === 1 ? a > b : a < b);

  const countCandles = (from: string, to: string) =>
    candles.filter((k) => k.date >= from && k.date <= to).length;

  // ── Einheiten aufbauen: Anker -> Peak (Welle 1) -> Trough (Welle 2) ──────
  const units: Unit[] = [];
  let anchorPrice = w5Price;
  let anchorDate = w5Date;
  let i = 0;
  while (i < piv.length) {
    const peak = piv.slice(i).find((p) => p.kind === peakKind && beyond(p.price, anchorPrice));
    if (!peak) break;
    const pIdx = piv.indexOf(peak);
    const trough = piv.slice(pIdx + 1).find((p) => p.kind === troughKind);
    if (!trough) break;

    // Welle 2 darf den Ursprung der Welle 1 nicht aufloesen
    if (!beyond(trough.price, anchorPrice)) break;

    const legLog = Math.abs(Math.log(peak.price) - Math.log(anchorPrice));
    const backLog = Math.abs(Math.log(peak.price) - Math.log(trough.price));
    const retrace = legLog > 0 ? backLog / legLog : 1;

    if (legLog < MIN_LEG_LOG) return EMPTY;
    if (countCandles(anchorDate, peak.date) < MIN_LEG_CANDLES) return EMPTY;
    if (retrace < MIN_RETRACE || retrace > MAX_RETRACE) return EMPTY;

    units.push({
      startPrice: anchorPrice, startDate: anchorDate,
      peakPrice: peak.price, peakDate: peak.date,
      troughPrice: trough.price, troughDate: trough.date,
      legLog, retrace,
    });

    anchorPrice = trough.price;
    anchorDate = trough.date;
    i = piv.indexOf(trough) + 1;
    if (units.length >= MAX_DEGREES + 2) break;
  }

  if (units.length < MIN_UNITS) return EMPTY;

  // Die erste Welle 1 muss strukturell impulsiv sein - sonst ist es kein
  // Trendbeginn, sondern eine beliebige Gegenbewegung.
  const firstImpulsive =
    segmentVerdict(candles, units[0].startDate, units[0].peakDate, dirCounter, parentThreshold) ===
    "IMPULSIVE";
  if (!firstImpulsive) return EMPTY;

  const last = units[units.length - 1];
  const currentInvalidation = last.troughPrice;
  const breached = candles.some(
    (k) => k.date > last.troughDate &&
      (dirCounter === 1 ? k.close < currentInvalidation : k.close > currentInvalidation)
  );
  const intact = !breached;

  // Verschachtelung: materiell schrumpfende Wellen-1, hoechstens 4 Grade
  let nested = units.length >= 2 && units.length <= MAX_DEGREES;
  for (let u = 1; u < units.length && nested; u++) {
    if (units[u].legLog > units[u - 1].legLog * NEST_SHRINK) nested = false;
  }

  const dirWord = dirCounter === 1 ? "höhere Tiefs" : "tiefere Hochs";
  const invWord = dirCounter === 1 ? "unter" : "über";

  let note: string | null;
  if (nested) {
    note = intact
      ? `Multi-1-2 · ${units.length} Grade · Marke ${currentInvalidation.toFixed(2)}`
      : `Multi-1-2 gebrochen (${invWord} ${currentInvalidation.toFixed(2)})`;
  } else if (intact) {
    note = `${units.length}× 1-2 · ${dirWord} · Marke ${currentInvalidation.toFixed(2)}`;
  } else {
    note = null; // gebrochene Treppe ist keine Meldung wert
  }

  return {
    active: nested && intact,
    legs: units.length,
    currentInvalidation,
    intact,
    note,
  };
}
