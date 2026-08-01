import type { Pivot } from "./zigzag";
import type { WaveCount, ImpulseResult } from "./impulseFinder";

/**
 * V154: Durchgehende Zaehlung ("von Anfang an").
 *
 * Der Finder waehlt die bestbewertete Fuenfersequenz und darf dabei beliebig
 * viele Pivots ueberspringen: BTC ueberspringt auf der 18-%-Stufe 16 von 36
 * Pivots, NET auf der 8-%-Stufe 72. Die Zaehlung greift sich fuenf Punkte aus
 * dem Verlauf - was dazwischen liegt, wird nicht erklaert.
 *
 * Diese Kennzahl macht das messbar:
 *  - skipped:  Pivots zwischen W0 und W5, die keine Wellenpunkte sind
 *  - before:   Pivots vor W0 (ungezaehlte Vorgeschichte)
 *  - after:    Pivots nach W5 (die laufende Korrektur - unkritisch)
 *  - ratio:    uebersprungene / aufgespannte Pivots (0 = lueckenlos)
 *
 * Ein gewisses Ueberspringen ist unvermeidbar und richtig: Wellen 1 und 3
 * enthalten Sub-Wellen, die auf der Elternstufe sichtbar sein KOENNEN. Aber
 * je hoeher die Quote, desto weniger erklaert die Zaehlung den Verlauf.
 */
export interface Continuity {
  skipped: number;
  before: number;
  after: number;
  ratio: number;
}

export function measureContinuity(pivots: Pivot[], count: WaveCount): Continuity | null {
  const idx = count.points.map((p) =>
    pivots.findIndex((q) => q.date === p.date && Math.abs(q.price - p.price) < 1e-6)
  );
  if (idx.some((i) => i < 0)) return null;

  let skipped = 0;
  for (let i = 1; i < idx.length; i++) skipped += Math.max(0, idx[i] - idx[i - 1] - 1);
  const span = idx[idx.length - 1] - idx[0];
  return {
    skipped,
    before: idx[0],
    after: pivots.length - 1 - idx[idx.length - 1],
    ratio: span > 0 ? skipped / span : 0,
  };
}

/**
 * Rangfolge unter (fast) gleichwertigen Kandidaten: bei einem Score-Rueckstand
 * von hoechstens `tol` gewinnt die durchgehendere Zaehlung.
 *
 * Absichtlich konservativ - der Score bleibt das primaere Kriterium, die
 * Kontinuitaet entscheidet nur den Stichkampf. Sonst wuerden triviale
 * Drei-Punkt-Zaehlungen gewinnen, die zwar lueckenlos sind, aber nichts
 * erklaeren.
 */
export function preferContinuous(
  ranked: ImpulseResult[],
  pivots: Pivot[],
  tol = 1
): { best: ImpulseResult; cont: Continuity | null; swapped: boolean } | null {
  if (ranked.length === 0) return null;
  const top = ranked[0];
  const topCont = measureContinuity(pivots, top.count);
  let best = top;
  let bestCont = topCont;
  let swapped = false;

  for (const cand of ranked.slice(1)) {
    if (top.score - cand.score > tol) break; // zu grosser Score-Rueckstand
    const c = measureContinuity(pivots, cand.count);
    if (!c || !bestCont) continue;
    // Deutlich durchgehender? (mind. 25 % weniger Luecken)
    if (c.ratio < bestCont.ratio * 0.75) {
      best = cand;
      bestCont = c;
      swapped = true;
    }
  }
  return { best, cont: bestCont, swapped };
}

export function continuityNote(c: Continuity): string {
  const pct = (c.ratio * 100).toFixed(0);
  const grade =
    c.ratio <= 0.25 ? "durchgehend" : c.ratio <= 0.6 ? "teilweise" : "lückenhaft";
  return (
    `🧩 Kontinuität: ${grade} (${pct} % übersprungen` +
    (c.before > 0 ? `, ${c.before} Pivots davor ungezählt` : "") +
    `)`
  );
}
