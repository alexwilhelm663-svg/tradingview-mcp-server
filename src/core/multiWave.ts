import type { Candle } from "./marketData";
import { Pivot, zigzag } from "./zigzag";
import { segmentVerdict } from "./impulseFinder";

export interface MultiWaveRead {
  active: boolean;                    // echte Grad-Verschachtelung UND intakt
  nested: boolean;                    // strukturell verschachtelt, auch nach Bruch
  legs: number;                       // Anzahl vollstaendiger 1-2-Einheiten
  currentInvalidation: number | null; // nachziehende Marke = letztes Welle-2-Extrem
  intact: boolean;
  breachDate: string | null;          // erster Schlusskurs-Bruch nach der letzten Welle 2
  breachClose: number | null;
  note: string | null;                // null = Schweigen
  /** V159: Wellenpunkte zum Einzeichnen - Anker, dann je Einheit 1 und 2. */
  points: { label: string; date: string; price: number }[];
}

const EMPTY: MultiWaveRead = {
  points: [],
  active: false, nested: false, legs: 0, currentInvalidation: null, intact: false,
  breachDate: null, breachClose: null, note: null,
};

export interface CloseBreach {
  date: string;
  close: number;
}

/**
 * Elliott-Hard-Rule fuer die nachziehende Welle-2-Marke: Ein spaeterer
 * Schlusskurs auf der falschen Seite invalidiert genau diesen Count dauerhaft.
 * Eine anschliessende Rueckkehr ueber/unter die Marke reaktiviert ihn nicht.
 */
export function findCloseBreach(
  candles: Candle[],
  afterDate: string,
  invalidation: number,
  dirCounter: 1 | -1
): CloseBreach | null {
  const hit = candles.find(
    (k) => k.date > afterDate &&
      (dirCounter === 1 ? k.close < invalidation : k.close > invalidation)
  );
  return hit ? { date: hit.date, close: hit.close } : null;
}

/**
 * Auswahl zwischen mehreren Ankern. V168 priorisierte nur `active` und danach
 * die Beinzahl. Dadurch konnte ein alter gebrochener Kandidat einen gleich
 * grossen, neueren intakten Kandidaten verdraengen. Status und Aktualitaet
 * muessen vor der historischen Laenge kommen.
 */
export function preferMultiWaveCandidate(
  candidate: MultiWaveRead,
  current: MultiWaveRead
): boolean {
  if (candidate.intact !== current.intact) return candidate.intact;
  if (candidate.nested !== current.nested) return candidate.nested;

  const candidateDate = candidate.points[candidate.points.length - 1]?.date ?? "";
  const currentDate = current.points[current.points.length - 1]?.date ?? "";
  if (candidateDate !== currentDate) return candidateDate > currentDate;
  return candidate.legs > current.legs;
}

/** Zentrale Gate-Funktion fuer Scanner: nur ein intakter Count ist ein Setup. */
export function isActionableMultiWave(read: MultiWaveRead): boolean {
  return read.intact && read.note !== null;
}

// ── Belastbarkeits-Anforderungen (V144) ────────────────────────────────────
// Vorher genuegten drei gestaffelte Pivots auf einer Schwelle, die aus der
// Amplitude abgeleitet war - bei einer jungen Bewegung also Rauschen. Jetzt
// muss jede 1-2-Einheit einzeln belegt sein, sonst wird geschwiegen.
const MIN_LEG_LOG = 0.05;      // jede Welle 1 mind. ~5 %
const MIN_LEG_CANDLES = 4;     // keine Zwei-Kerzen-Wellen
const MIN_RETRACE = 0.236;     // Welle 2 muss wirklich korrigieren
const MAX_RETRACE = 0.90;      // ... aber die Welle 1 nicht aufloesen
const MIN_UNITS = 2;           // mind. zwei vollstaendige 1-2
// V160: Eine Welle 2 ist erst vollstaendig, wenn der Markt sie bestaetigt hat.
// Ohne diese Huerde zaehlt die Erkennung das juengste Tief als fertige Einheit,
// obwohl der Ruecksetzer noch laeuft - bei NVO wurde so eine dritte Einheit
// gemeldet, deren "2" die letzte Kerze war (Marke 46,44 statt belastbarer
// 41,00). Denselben Fehler hatte der Screener; dort loeste ihn V157.
const MIN_TROUGH_AGE = 5;      // Kerzen seit dem Welle-2-Tief
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
/**
 * V156: Ankersuche. Ein Multi-1-2 baut sich am BEGINN einer Gegenbewegung auf -
 * nicht zwingend nach der Welle 5 der Hauptzaehlung. Genau daran scheiterte
 * die Erkennung: W5 liegt bei den meisten Titeln erst wenige Kerzen zurueck
 * (LLY 5, BILL 8), womit die 12-Kerzen-Mindestlaenge greift, bevor ueberhaupt
 * geprueft wird - gemessen 0 Treffer ueber 20 Titel.
 *
 * Kandidaten sind daher W5 UND die markanten Gegen-Extrema der juengeren
 * Vergangenheit (20-150 Kerzen zurueck). Der beste Treffer gewinnt.
 */
function anchorCandidates(
  candles: Candle[],
  w5Date: string,
  w5Price: number,
  dirCounter: 1 | -1
): { date: string; price: number }[] {
  const out: { date: string; price: number }[] = [{ date: w5Date, price: w5Price }];
  const n = candles.length;
  const want: "L" | "H" = dirCounter === 1 ? "L" : "H";
  const seen = new Set<string>([w5Date]);
  for (const th of [15, 12, 9]) {
    for (const p of zigzag(candles, th)) {
      if (p.kind !== want || seen.has(p.date)) continue;
      const i = candles.findIndex((k) => k.date === p.date);
      if (i < 0) continue;
      const age = n - 1 - i;
      if (age < 20 || age > 150) continue;
      seen.add(p.date);
      out.push({ date: p.date, price: p.price });
    }
  }
  return out;
}

export function assessMultiWave(
  candles: Candle[],
  w5Date: string,
  w5Price: number,
  dirCounter: 1 | -1,
  parentThreshold: number
): MultiWaveRead {
  // Alle plausiblen Anker durchprobieren, besten Treffer nehmen.
  const cands = anchorCandidates(candles, w5Date, w5Price, dirCounter);
  let best: MultiWaveRead | null = null;
  for (const a of cands) {
    const r = assessFromAnchor(candles, a.date, a.price, dirCounter, parentThreshold);
    if (!r.note) continue;
    if (best === null || preferMultiWaveCandidate(r, best)) {
      best = r;
    }
  }
  return best ?? EMPTY;
}

function assessFromAnchor(
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
    // Welle-2-Tief muss ueberstanden sein - sonst laeuft der Ruecksetzer noch
    // und die Einheit ist unfertig. Abbrechen statt verwerfen: die bereits
    // gesammelten Einheiten bleiben gueltig.
    const troughIdx = candles.findIndex((k) => k.date === trough.date);
    if (troughIdx < 0 || candles.length - 1 - troughIdx < MIN_TROUGH_AGE) break;

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
  const breach = findCloseBreach(candles, last.troughDate, currentInvalidation, dirCounter);
  const intact = breach === null;

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
      : `Multi-1-2 gebrochen · ${breach!.date.slice(0, 10)} Schluss ` +
        `${breach!.close.toFixed(2)} ${invWord} Marke ${currentInvalidation.toFixed(2)}`;
  } else if (intact) {
    note = `${units.length}× 1-2 · ${dirWord} · Marke ${currentInvalidation.toFixed(2)}`;
  } else {
    note = null; // gebrochene Treppe ist keine Meldung wert
  }

  // Punkte fuer den Chart: Startanker, dann je Einheit das Welle-1-Ende (1)
  // und das Welle-2-Ende (2). Damit ist die Staffelung sichtbar statt nur als
  // Textnotiz beschrieben.
  const points: { label: string; date: string; price: number }[] = [
    { label: "", date: units[0].startDate, price: units[0].startPrice },
  ];
  for (const u of units) {
    points.push({ label: "1", date: u.peakDate, price: u.peakPrice });
    points.push({ label: "2", date: u.troughDate, price: u.troughPrice });
  }

  return {
    active: nested && intact,
    nested,
    legs: units.length,
    currentInvalidation,
    intact,
    breachDate: breach?.date ?? null,
    breachClose: breach?.close ?? null,
    note,
    points,
  };
}
