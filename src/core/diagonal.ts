import type { Candle } from "./marketData";
import { zigzag, Pivot } from "./zigzag";

export interface DiagonalRead {
  points: { label: string; date: string; price: number }[];
  contraction: number; // Kanalbreite Ende / Anfang (Log-Raum), < 1 = konvergent
  overlap: boolean;
  throwOver: boolean;
  endDate: string;
  endPrice: number;
}

/**
 * Diagonal-Detektor (V116, DG-1/DG-2):
 * Sucht in einem Segment einen kanonischen Keil in Bewegungsrichtung:
 *   - fuenf Beine 1..5, alternierend, jedes Antriebsbein setzt ein neues Extrem
 *   - Kontraktion: |W3| < |W1| und |W5| < |W3| (Log-Laengen)
 *   - Overlap-PFLICHT: W4 dringt in das W1-Preisgebiet ein (Unterscheidung
 *     zum Impuls, HR-3-Ausnahme des Kanons)
 *   - W2 verletzt den Ursprung nicht; W4 geht nicht ueber das W2-Ende hinaus
 *   - 2-4-Linie konvergiert zur 1-3-Linie (Kanalbreite am W4 < 85% der
 *     Breite am W2); Throw-over der 5 ueber die 1-3-Linie wird erkannt
 * Der Detektor aendert die Impuls-Suche nicht - er liefert eine
 * Terminal-Lesart fuer Segmente, die sich nicht impulsiv unterteilen.
 * dir = Richtung der Diagonale: +1 aufwaerts, -1 abwaerts.
 */
export function detectDiagonal(candles: Candle[], dir: 1 | -1): DiagonalRead | null {
  if (candles.length < 12) return null;

  const corKind = dir === 1 ? "L" : "H";
  for (const th of [12, 8, 5, 3]) {
    const pivots = zigzag(candles, th);

    // Segment-Ursprung ergaenzen: Das Startextrem einer Serie ist
    // konstruktionsbedingt nie ein ZigZag-Pivot (der Algorithmus committet
    // erst bei der ersten Umkehr). Ein C-Segment BEGINNT aber an seinem
    // Ursprung (B-Extrem) - ohne ihn fehlen dem Keil zwei Beine.
    if (pivots.length > 0 && pivots[0].kind !== corKind) {
      const head = candles.slice(0, pivots[0].index + 1);
      let originIdx = 0;
      for (let i = 1; i < head.length; i++) {
        const better =
          dir === -1
            ? head[i].high > head[originIdx].high
            : head[i].low < head[originIdx].low;
        if (better) originIdx = i;
      }
      pivots.unshift({
        index: originIdx,
        date: head[originIdx].date,
        price: dir === -1 ? head[originIdx].high : head[originIdx].low,
        kind: corKind,
      });
    }

    if (pivots.length < 6) continue;
    const read = searchWedge(pivots, dir);
    if (read) return read;
  }
  return null;
}

function searchWedge(pivots: Pivot[], dir: 1 | -1): DiagonalRead | null {
  // Antriebs-Extreme der Diagonale: in Bewegungsrichtung (dir=-1 -> Tiefs)
  const impKind = dir === 1 ? "H" : "L";
  const corKind = dir === 1 ? "L" : "H";
  const v = (p: Pivot): number => dir * p.price; // vorzeichen-neutral
  const ln = (p: Pivot): number => dir * Math.log(p.price);

  const origins = pivots.filter((p) => p.kind === corKind);
  let best: DiagonalRead | null = null;

  for (const p0 of origins) {
    const after = pivots.filter((p) => p.index > p0.index);
    const imp = after.filter((p) => p.kind === impKind);
    const cor = after.filter((p) => p.kind === corKind);

    for (const w1 of imp) {
      if (v(w1) <= v(p0)) continue;
      for (const w2 of cor.filter((p) => p.index > w1.index)) {
        if (v(w2) <= v(p0)) continue; // W2 verletzt den Ursprung nicht
        for (const w3 of imp.filter((p) => p.index > w2.index)) {
          if (v(w3) <= v(w1)) continue; // neues Extrem
          for (const w4 of cor.filter((p) => p.index > w3.index)) {
            // Keil-Bedingung: die 2-4-Linie laeuft der Bewegungsrichtung
            // hinterher -> W4 liegt (in Trendrichtung gemessen) JENSEITS
            // von W2: v(w4) > v(w2). Sonst kein kontrahierender Keil.
            if (v(w4) <= v(w2)) continue;
            // Overlap-PFLICHT: W4 dringt in das W1-Preisgebiet ein
            // (sonst waere es Impuls-Geometrie, kein Diagonal-Kandidat)
            if (!(v(w4) < v(w1))) continue;
            for (const w5 of imp.filter((p) => p.index > w4.index)) {
              if (v(w5) <= v(w3)) continue; // neues Extrem

              // Kontraktion der Beinlaengen (Log)
              const L1 = ln(w1) - ln(p0);
              const L3 = ln(w3) - ln(w2);
              const L5 = ln(w5) - ln(w4);
              if (!(L3 < L1 && L5 < L3)) continue;

              // Linien-Konvergenz im Log-Index-Raum
              const line = (a: Pivot, b: Pivot) => {
                const m = (ln(b) - ln(a)) / (b.index - a.index);
                return (i: number): number => ln(a) + m * (i - a.index);
              };
              const l13 = line(w1, w3);
              const l24 = line(w2, w4);
              const widthAt = (i: number): number => l13(i) - l24(i);
              const wEarly = widthAt(w2.index);
              const wLate = widthAt(w4.index);
              if (!(wEarly > 0 && wLate > 0)) continue;
              const contraction = wLate / wEarly;
              if (contraction >= 0.85) continue; // nicht ausreichend konvergent

              const throwOver = ln(w5) > l13(w5.index);

              const seq = [p0, w1, w2, w3, w4, w5];
              const read: DiagonalRead = {
                points: seq.map((p, i) => ({
                  label: i === 0 ? "0" : `${i}`,
                  date: p.date,
                  price: p.price,
                })),
                contraction,
                overlap: true,
                throwOver,
                endDate: w5.date,
                endPrice: w5.price,
              };
              // spaeteste, am staerksten kontrahierte Variante bevorzugen
              if (
                !best ||
                w5.index > seqEndIndex(best, pivots) ||
                (w5.index === seqEndIndex(best, pivots) && contraction < best.contraction)
              ) {
                best = read;
              }
            }
          }
        }
      }
    }
  }
  return best;
}

function seqEndIndex(read: DiagonalRead, pivots: Pivot[]): number {
  const last = read.points[read.points.length - 1];
  const p = pivots.find((x) => x.date === last.date && x.price === last.price);
  return p ? p.index : -1;
}
