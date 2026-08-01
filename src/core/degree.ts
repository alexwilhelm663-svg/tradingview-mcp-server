import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";

/**
 * V153: Wellengrad + empirisches Korrektur-Raster.
 *
 * Beantwortet drei Fragen, die die Fuenferzaehlung offen laesst:
 *  1. Auf welchem GRAD bewegen wir uns? (Elliott-Leiter nach Log-Spanne)
 *  2. Wie tief korrigiert DIESER Titel historisch? (nicht Lehrbuch, sondern
 *     seine eigene Statistik)
 *  3. Wie lange dauern seine Korrekturen?
 *
 * Wichtig: Gezaehlt werden nur ECHTE Korrekturen - Gegenbewegungen, die den
 * vorangegangenen Antrieb zu 20-90 % zuruecknehmen. Ein naiver Ansatz, der
 * jedes ZigZag-Bein als Korrektur zaehlt, liefert Median-Retracements um 1,0
 * und Maxima ueber 5 - dort wird der Trend selbst als Korrektur gezaehlt.
 */

const LADDER: { name: string; max: number }[] = [
  { name: "Subminuette", max: 0.10 },
  { name: "Minuette", max: 0.22 },
  { name: "Minute", max: 0.45 },
  { name: "Minor", max: 0.85 },
  { name: "Intermediate", max: 1.60 },
  { name: "Primary", max: 3.00 },
  { name: "Cycle", max: 5.50 },
  { name: "Supercycle", max: Infinity },
];

const gradeOf = (logSpan: number) =>
  (LADDER.find((g) => logSpan <= g.max) ?? LADDER[LADDER.length - 1]).name;

export interface CorrStats {
  n: number;
  retrMin: number; retrMed: number; retrMax: number;
  barsMin: number; barsMed: number; barsMax: number;
}

export interface DegreeRead {
  cycleGrade: string;    // Grad der Gesamtspanne im Fenster
  legGrade: string;      // Grad der typischen Bewegung
  spanLog: number;
  stats: CorrStats | null;
  note: string;
  zoneNote: string | null; // Einstiegsraster aus der eigenen Historie
}

const med = (a: number[]) => a[Math.floor(a.length / 2)];

/** Echte Antrieb-Korrektur-Paare auf einer Stufe sammeln. */
function collectCorrections(c: Candle[], th: number) {
  const piv = zigzag(c, th);
  const idx = (d: string) => c.findIndex((k) => k.date === d);
  const out: { retr: number; bars: number }[] = [];
  for (let i = 2; i < piv.length; i++) {
    const a = piv[i - 2], b = piv[i - 1], d = piv[i];
    const leg = Math.abs(Math.log(b.price) - Math.log(a.price));
    const back = Math.abs(Math.log(d.price) - Math.log(b.price));
    if (leg <= 0) continue;
    const retr = back / leg;
    // Nur echte Korrekturen: 20-90 % des Antriebs. Darueber ist es kein
    // Ruecksetzer mehr, sondern eine Trendumkehr.
    if (retr < 0.20 || retr > 0.90) continue;
    // Der Antrieb muss die groessere Bewegung sein
    const legBars = idx(b.date) - idx(a.date);
    const corrBars = idx(d.date) - idx(b.date);
    if (legBars < 2 || corrBars < 1) continue;
    out.push({ retr, bars: corrBars });
  }
  return out;
}

export function readDegree(candles: Candle[], currentPrice: number): DegreeRead | null {
  if (candles.length < 40) return null;

  const highs = candles.map((k) => k.high);
  const lows = candles.map((k) => k.low);
  const spanLog = Math.log(Math.max(...highs)) - Math.log(Math.min(...lows));

  // Typische Beinlaenge auf mittlerer Stufe
  const piv = zigzag(candles, 22);
  let sum = 0;
  for (let i = 1; i < piv.length; i++) {
    sum += Math.abs(Math.log(piv[i].price) - Math.log(piv[i - 1].price));
  }
  const avgLeg = piv.length > 1 ? sum / (piv.length - 1) : 0;

  // Korrekturen ueber mehrere Stufen sammeln, damit die Stichprobe traegt
  const all = [
    ...collectCorrections(candles, 22),
    ...collectCorrections(candles, 15),
    ...collectCorrections(candles, 10),
  ];
  let stats: CorrStats | null = null;
  if (all.length >= 6) {
    const rs = all.map((x) => x.retr).sort((a, b) => a - b);
    const bs = all.map((x) => x.bars).sort((a, b) => a - b);
    stats = {
      n: all.length,
      retrMin: rs[0], retrMed: med(rs), retrMax: rs[rs.length - 1],
      barsMin: bs[0], barsMed: med(bs), barsMax: bs[bs.length - 1],
    };
  }

  const cycleGrade = gradeOf(spanLog);
  const legGrade = gradeOf(avgLeg);
  const note =
    `📐 Grad: Fensterspanne ${spanLog.toFixed(2)} log → ${cycleGrade} · ` +
    `typische Bewegung → ${legGrade}`;

  let zoneNote: string | null = null;
  if (stats) {
    zoneNote =
      `📊 Korrektur-Raster (${stats.n} eigene): Retracement ` +
      `${(stats.retrMin * 100).toFixed(0)}–${(stats.retrMed * 100).toFixed(0)}–${(stats.retrMax * 100).toFixed(0)} % · ` +
      `Dauer ${stats.barsMin}–${stats.barsMed}–${stats.barsMax} Kerzen`;
  }

  return { cycleGrade, legGrade, spanLog, stats, note, zoneNote };
}

/**
 * Einstiegsraster fuer eine LAUFENDE Korrektur: wo liegen die Zonen nach der
 * EIGENEN Historie des Titels, und wie weit ist die Korrektur zeitlich?
 */
export function entryGrid(
  stats: CorrStats,
  motiveFrom: number,
  motiveTo: number,
  barsSoFar: number
): string {
  const legLog = Math.log(motiveTo) - Math.log(motiveFrom);
  const at = (r: number) => Math.exp(Math.log(motiveTo) - r * legLog);
  const zMed = at(stats.retrMed);
  const zMax = at(stats.retrMax);
  const timePos =
    barsSoFar < stats.barsMed
      ? `früh (${barsSoFar} von median ${stats.barsMed} K)`
      : barsSoFar <= stats.barsMax
        ? `reif (${barsSoFar} K, median ${stats.barsMed}, max ${stats.barsMax})`
        : `überfällig (${barsSoFar} K > max ${stats.barsMax})`;
  return (
    `🎯 Einstiegsraster (eigene Historie): ` +
    `median ${zMed.toFixed(2)} · tief ${zMax.toFixed(2)} · Zeit ${timePos}`
  );
}
