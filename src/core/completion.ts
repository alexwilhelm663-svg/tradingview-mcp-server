import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";
import { WaveCount, findPartialImpulse, subThresholds } from "./impulseFinder";

export interface CompletionRead {
  status: "COMPLETE" | "IN_PROGRESS";
  subLabel: string | null; // erreichte Sub-Welle innerhalb W5, z.B. "3"
  note: string;
  projections: { label: string; price: number }[];
  subPoints: { label: string; date: string; price: number }[]; // Binnenstruktur für Detail-Chart
  subThreshold: number | null;
  timeWindows: { start: string; end: string; label: string }[]; // V120b: Fib-Zeit-Projektion
}

const addDays = (iso: string, d: number): string => {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + Math.round(d));
  return x.toISOString().split("T")[0];
};
const daysBetween = (a: string, b: string): number =>
  (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000;

/**
 * Vollendungs-Nachweis (V118, DK-9):
 * Der 0-5-Finder erklaert die letzte Spitze qua VG-3 immer zur Welle 5 -
 * er kann strukturell nichts anderes als "fertig". Diese Analyse fragt
 * unabhaengig nach: Loest sich das W4->W5-Segment als KOMPLETTER 5-Teiler
 * auf (dann ist der Impuls vollendet), oder nur als laufende Teilsequenz
 * (0-1 / 0..3 / 0..4)? Im zweiten Fall wird die naechste erwartete Welle
 * projiziert (Fibonacci, Log-Raum gemaess DK-2).
 *
 * Wichtig: rein diagnostisch. Aendert die 0-5-Zaehlung NICHT (die bleibt
 * die beste vollstaendige Lesart), sondern ergaenzt sie um den Hinweis,
 * dass Welle 5 selbst noch unfertig sein koennte - mit Kurszielen.
 */
export function assessCompletion(
  candles: Candle[],
  wc: WaveCount,
  parentThreshold: number
): CompletionRead | null {
  const dir: 1 | -1 = wc.trend === "bullish" ? 1 : -1;
  const w4 = wc.points.find((p) => p.label === "4");
  const w5 = wc.points.find((p) => p.label === "5");
  if (!w4 || !w5) return null;

  const seg = candles.filter((c) => c.date >= w4.date);
  if (seg.length < 10) return null;

  // V127 Prämissen-Check: "Welle 5 läuft noch" ist nur haltbar, solange der
  // aktuelle Kurs noch in der Nähe des W5-Extrems steht. Hat er sich bereits
  // deutlich (> 15% log) davon entfernt, ist W5 abgeschlossen und eine
  // Korrektur/Gegenbewegung im Gang - dann trifft assessCompletion keine
  // "IN_PROGRESS"-Aussage mehr (verhindert Selbst-Widerspruch zum ABC).
  const lastPx = candles[candles.length - 1].close;
  const awayLog = Math.abs(Math.log(lastPx) - Math.log(w5.price));
  const farFromW5 = awayLog > 0.15;

  const ln = (a: number, b: number): number => dir * (Math.log(b) - Math.log(a));
  const logProject = (base: number, len: number, k: number): number =>
    Math.exp(Math.log(base) + dir * k * len);

  // Feinste sinnvolle Sub-Stufe fuer die W5-Binnenstruktur
  for (const th of subThresholds(parentThreshold)) {
    const piv = zigzag(seg, th);
    if (piv.length < 4) continue;

    // Ist die W5-Binnenstruktur ein KOMPLETTER 5-Teiler? -> Impuls vollendet.
    const fullWithFive = piv.length >= 6 ? findFive(piv, dir) : false;
    if (fullWithFive) {
      const five = findPartialImpulse(piv, dir, 5);
      return {
        status: "COMPLETE",
        subLabel: "5",
        note: `Welle 5 ist binnenstrukturell abgeschlossen (Sub-5-Teiler auf ${th}%): Impuls vollendet, Korrektur wahrscheinlich.`,
        projections: [],
        subPoints: fullSubPoints(piv, dir),
        subThreshold: th,
        timeWindows: [],
      };
    }

    // Laufende Teilsequenz? Reihenfolge: je weiter, desto aussagekraeftiger.
    const p4 = findPartialImpulse(piv, dir, 4); // Sub bei 3 -> W4_sub, W5_sub folgen
    const p2 = findPartialImpulse(piv, dir, 2); // Sub bei 1 -> W2_sub, dann 3 folgt

    if (p4 && !farFromW5) {
      const s0 = p4.points[0].price;
      const s1 = p4.points[1].price;
      const s3 = p4.points[3].price; // aktuelle Sub-3-Spitze
      const l1 = ln(s0, s1);         // Laenge Sub-Welle 1 (Log)
      // Sub-4 steht noch aus; Sub-5 wird typischerweise von der Sub-4-Basis
      // getragen. Naeherung: Sub-4 endet nahe der Sub-3-Spitze (flache
      // Vierte), daher Projektion ab s3. Ehrlich als Naeherung deklariert.
      return {
        status: "IN_PROGRESS",
        subLabel: "3",
        note: `Welle 5 läuft noch: Binnenstruktur zeigt Sub-Welle 3 (auf ${th}%) – Sub-4/Sub-5 stehen aus, der Impuls ist NICHT abgeschlossen. Zielspanne (Näherung ab Sub-3, Sub-4 noch offen):`,
        projections: [
          { label: "Sub-5≈0.618×Sub-1", price: logProject(s3, l1, 0.618) },
          { label: "Sub-5≈1.0×Sub-1", price: logProject(s3, l1, 1.0) },
        ],
        subPoints: p4.points,
        subThreshold: th,
        timeWindows: (() => {
          const t2d = daysBetween(p4.points[1].date, p4.points[2].date);
          const s3d = p4.points[3].date;
          return t2d > 0
            ? [{ start: addDays(s3d, 1.0 * t2d), end: addDays(s3d, 3.0 * t2d), label: "Sub-4-Fenster 1.0–3.0×t(Sub-2)" }]
            : [];
        })(),
      };
    }

    if (p2 && !farFromW5) {
      const s0 = p2.points[0].price;
      const s1 = p2.points[1].price;
      const l1 = ln(s0, s1);
      return {
        status: "IN_PROGRESS",
        subLabel: "1",
        note: `Welle 5 läuft noch: Binnenstruktur erst bei Sub-Welle 1 (auf ${th}%), Sub-2 bis Sub-5 stehen aus. Fruehe Phase des finalen Impulses.`,
        projections: [
          { label: "Sub-3 ≈ 1.618×Sub-1", price: logProject(s1, l1, 1.618) },
          { label: "Sub-3 ≈ 2.618×Sub-1", price: logProject(s1, l1, 2.618) },
        ],
        subPoints: p2.points,
        subThreshold: th,
        timeWindows: (() => {
          const t1d = daysBetween(p2.points[0].date, p2.points[1].date);
          const s1d = p2.points[1].date;
          return t1d > 0
            ? [{ start: addDays(s1d, 0.382 * t1d), end: addDays(s1d, 2.0 * t1d), label: "Sub-2-Fenster 0.382–2.0×t(Sub-1)" }]
            : [];
        })(),
      };
    }
  }

  return null; // keine belastbare Sub-Aussage -> stumm (Zaehlung bleibt wie sie ist)
}

/** Extrahiert die 0-5-Punkte des Sub-Impulses (fuer den Detail-Chart). */
function fullSubPoints(pivots: ReturnType<typeof zigzag>, dir: 1 | -1): { label: string; date: string; price: number }[] {
  const impKind = dir === 1 ? "H" : "L";
  const corKind = dir === 1 ? "L" : "H";
  const v = (p: (typeof pivots)[number]): number => dir * p.price;
  const pool = pivots.filter((p) => p.kind === corKind);
  if (pool.length === 0) return [];
  const w0 = pool.reduce((m, x) => (v(x) < v(m) ? x : m));
  const after = pivots.filter((p) => p.index > w0.index);
  const imp = after.filter((p) => p.kind === impKind);
  const cor = after.filter((p) => p.kind === corKind);
  for (const w1 of imp) {
    if (v(w1) <= v(w0)) continue;
    for (const w2 of cor.filter((x) => x.index > w1.index)) {
      if (v(w2) <= v(w0)) continue;
      for (const w3 of imp.filter((x) => x.index > w2.index)) {
        if (v(w3) <= v(w1)) continue;
        for (const w4 of cor.filter((x) => x.index > w3.index)) {
          if (v(w4) <= v(w1)) continue;
          for (const w5 of imp.filter((x) => x.index > w4.index)) {
            if (v(w5) > v(w3)) {
              return [w0, w1, w2, w3, w4, w5].map((x, i) => ({ label: String(i), date: x.date, price: x.price }));
            }
          }
        }
      }
    }
  }
  return [];
}

/** Existiert im Segment ein vollstaendiger regelkonformer 0-5-Impuls? */
function findFive(pivots: ReturnType<typeof zigzag>, dir: 1 | -1): boolean {
  const impKind = dir === 1 ? "H" : "L";
  const corKind = dir === 1 ? "L" : "H";
  const v = (p: (typeof pivots)[number]): number => dir * p.price;
  const pool = pivots.filter((p) => p.kind === corKind);
  if (pool.length === 0) return false;
  const w0 = pool.reduce((m, x) => (v(x) < v(m) ? x : m));
  const after = pivots.filter((p) => p.index > w0.index);
  const imp = after.filter((p) => p.kind === impKind);
  const cor = after.filter((p) => p.kind === corKind);
  for (const w1 of imp) {
    if (v(w1) <= v(w0)) continue;
    for (const w2 of cor.filter((x) => x.index > w1.index)) {
      if (v(w2) <= v(w0)) continue;
      for (const w3 of imp.filter((x) => x.index > w2.index)) {
        if (v(w3) <= v(w1)) continue;
        for (const w4 of cor.filter((x) => x.index > w3.index)) {
          if (v(w4) <= v(w1)) continue;
          for (const w5 of imp.filter((x) => x.index > w4.index)) {
            if (v(w5) > v(w3)) return true;
          }
        }
      }
    }
  }
  return false;
}
