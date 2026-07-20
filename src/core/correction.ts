import type { Candle } from "./marketData";
import { Pivot } from "./zigzag";
import { segmentVerdict, SubVerdict } from "./impulseFinder";

export type CorrectionPattern =
  | "ZIGZAG"
  | "DOUBLE_ZIGZAG"
  | "FLAT_REGULAR"
  | "FLAT_EXPANDED"
  | "FLAT_RUNNING_VERDACHT"
  | "TRIANGLE"
  | "KOMBINATION"
  | "UNKLAR";

export interface CorrectionRead {
  pattern: CorrectionPattern;
  text: string;
  targetPrice: number | null;
  targetLabel: string | null;
  cOverA: number | null;
  // V125: A-B-C bzw. W-X-Y Strukturpunkte + Labels fuer den Chart
  legPoints: { label: string; date: string; price: number }[];
}

export interface CorrectionContext {
  candles: Candle[];
  parentThreshold: number;
  topDate: string; // Impuls-Ende (Korrektur-Beginn)
  aDate: string | null;
  bDate: string | null;
}

/**
 * KO-Vollkatalog (V124). Klassifikation der Korrektur nach dem Impuls:
 * Ratio-Baender (linear, kanonische Preis-Definitionen) PLUS
 * Struktur-Beweis (segmentVerdict auf dem A-Bein: 5er -> Zigzag-Familie,
 * 3er/unklar -> Flat-Familie). Extension-ZIELE logarithmisch (DK-2).
 */
export function classifyCorrection(
  w5Price: number,
  aExtreme: number,
  bExtreme: number,
  cExtremeSoFar: number | null,
  currentPrice: number,
  postTopPivots: Pivot[],
  dir: 1 | -1 = 1,
  ctx?: CorrectionContext
): CorrectionRead {
  const A = dir * (w5Price - aExtreme);
  const bRetr = A > 0 ? (dir * (bExtreme - aExtreme)) / A : 0;
  const cOverA =
    A > 0 && cExtremeSoFar != null ? (dir * (bExtreme - cExtremeSoFar)) / A : null;

  // ── Struktur-Beweis: A-Bein impulsiv? (KO-1) ──
  let aVerdict: SubVerdict | null = null;
  if (ctx && ctx.aDate) {
    aVerdict = segmentVerdict(
      ctx.candles, ctx.topDate, ctx.aDate, (dir * -1) as 1 | -1, ctx.parentThreshold
    );
  }

  // ── Triangle-Erkennung (KO-5): ab B alternierende, schrumpfende Beine ──
  const tri = ctx && ctx.bDate ? detectTriangleLegs(postTopPivots, ctx.bDate, dir) : null;

  let pattern: CorrectionPattern;
  if (tri) pattern = "TRIANGLE";
  else if (bRetr >= 0.9 && bRetr <= 1.05) pattern = "FLAT_REGULAR";
  else if (bRetr > 1.05) pattern = "FLAT_EXPANDED";
  else if (bRetr >= 0.382 && bRetr <= 0.786) pattern = "ZIGZAG";
  else if (bRetr > 0.786 && bRetr < 0.9)
    // Grauzone: Struktur-Beweis entscheidet (Koenz: 0.886-Touch => korrektiv)
    pattern = aVerdict === "IMPULSIVE" ? "ZIGZAG" : "UNKLAR";
  else pattern = "UNKLAR";

  // Zigzag mit weit ueberschossenem C -> Double-Zigzag-These (KO-2b)
  if (pattern === "ZIGZAG" && cOverA != null && cOverA > 1.75) pattern = "DOUBLE_ZIGZAG";
  // KO-6 WXY-Vollprüfung (V125): Eine Kombination liegt vor, wenn das
  // erste Korrektur-Bein (W) selbst NICHT impulsiv ist (also eine
  // zusammengesetzte 3er-Struktur), verbunden durch eine X-Welle. Der
  // Struktur-Beweis am A(=W)-Bein ist der Entscheider ABC vs. WXY:
  //   A-Bein impulsiv (5er) -> echtes ABC (Zigzag/Flat bleibt);
  //   A-Bein 3er/unklar bei ausreichender Datenlage -> W-X-Y.
  if (
    (pattern === "ZIGZAG" || pattern === "UNKLAR") &&
    aVerdict === "UNKLAR" && ctx && ctx.aDate
  ) {
    const wLen = ctx.candles.filter((c) => c.date >= ctx.topDate && c.date <= ctx.aDate!).length;
    // W muss substanziell sein (>= 6 Kerzen echtes Bein, nicht nur Rauschen)
    // UND nicht-impulsiv (3er) - dann ist es ein zusammengesetztes W statt
    // eines einfachen Zigzag-A. Kurze/impulsive A-Beine bleiben Zigzag.
    if (wLen >= 6) pattern = "KOMBINATION";
  }
  // Running-Flat-Verdacht (KO-4): B ueberschiesst, C haelt DEUTLICH ueber A
  if (
    (pattern === "FLAT_EXPANDED" || pattern === "FLAT_REGULAR") &&
    cOverA != null && cOverA > 0.1 && cOverA < 0.85 &&
    dir * (currentPrice - (cExtremeSoFar ?? currentPrice)) > 0
  ) {
    pattern = "FLAT_RUNNING_VERDACHT";
  }

  // ── Ziele: LOG-projiziert (DK-2), typische Baender je Muster ──
  const kSet =
    pattern === "ZIGZAG" ? [1.0, 1.236, 1.618]
    : pattern === "DOUBLE_ZIGZAG" ? [2.0, 2.618]
    : pattern === "FLAT_EXPANDED" ? [1.618, 2.0, 2.618]
    : pattern === "FLAT_REGULAR" ? [1.0, 1.236]
    : pattern === "KOMBINATION" ? [1.0, 1.382, 1.618]
    : [1.0, 1.618];

  let targetPrice: number | null = null;
  let targetLabel: string | null = null;
  const koId =
    pattern === "ZIGZAG" ? "KO-2" : pattern === "DOUBLE_ZIGZAG" ? "KO-2b"
    : pattern === "FLAT_REGULAR" || pattern === "FLAT_EXPANDED" ? "KO-3"
    : pattern === "FLAT_RUNNING_VERDACHT" ? "KO-4"
    : pattern === "TRIANGLE" ? "KO-5"
    : pattern === "KOMBINATION" ? "KO-6" : "KO";
  const logOk = w5Price > 0 && aExtreme > 0 && bExtreme > 0;
  const logA = logOk ? dir * (Math.log(w5Price) - Math.log(aExtreme)) : 0;
  if (pattern !== "TRIANGLE" && pattern !== "FLAT_RUNNING_VERDACHT") {
    for (const k of kSet) {
      const level = logOk
        ? Math.exp(Math.log(bExtreme) - dir * k * logA)
        : bExtreme - dir * k * A;
      if (level > 0 && dir * (currentPrice - level) > 0) {
        targetPrice = level;
        targetLabel = `KO-Ziel ${logOk ? "logC" : "C"}=${k}·A (${koId})`;
        break;
      }
    }
  }
  if (pattern === "TRIANGLE" && tri) {
    // Thrust-Ziel: Hoehe des a-Beins (log) ab mutmasslichem e-Ende
    const thrust = Math.exp(Math.log(tri.lastPrice) - dir * tri.aHeightLog);
    targetPrice = thrust > 0 ? thrust : null;
    targetLabel = targetPrice != null ? `Thrust-Ziel (KO-5)` : null;
  }

  // ── Text ──
  const name =
    pattern === "ZIGZAG" ? "Zigzag (KO-2)"
    : pattern === "DOUBLE_ZIGZAG" ? "Double Zigzag (KO-2b)"
    : pattern === "FLAT_REGULAR" ? "Regular Flat (KO-3)"
    : pattern === "FLAT_EXPANDED" ? "Expanded Flat (KO-3)"
    : pattern === "FLAT_RUNNING_VERDACHT" ? "Running-Flat-Verdacht (KO-4)"
    : pattern === "TRIANGLE" ? `Triangle (KO-5, ${"" + (tri?.legs ?? 0)} Beine, kontrahierend)`
    : pattern === "KOMBINATION" ? "Kombination W-X-Y (KO-6, A-Bein nicht impulsiv)"
    : bRetr > 0.786 && bRetr < 0.9 ? "unklar (Grauzone 0,786–0,9)"
    : "unklar";
  let text = `Korrektur-Lesart: ${name} · B = ${bRetr.toFixed(2)}×A`;
  if (cOverA != null) text += ` · C bisher ${cOverA.toFixed(2)}×A`;
  if (pattern === "KOMBINATION")
    text += ` · W-Bein nicht impulsiv (3er) ⇒ zusammengesetzt statt Zigzag (Struktur-Beweis)`;
  else if (aVerdict === "IMPULSIVE") text += ` · A-Bein impulsiv ✓ (Zigzag bestätigt, Struktur-Beweis)`;
  else if (aVerdict === "UNKLAR" && ctx?.aDate) text += ` · A-Struktur unklar`;
  if (pattern === "FLAT_EXPANDED" && bRetr >= 1.618)
    text += ` · ⚠️ B ≥ 1.618×A (senkt Wahrscheinlichkeit deutlich)`;
  if (pattern === "FLAT_RUNNING_VERDACHT")
    text += ` · C hält über dem A-Extrem – trendstarkes Signal`;
  if (targetPrice != null) text += ` · präferiertes C-Ziel (log) ${targetPrice.toFixed(2)}`;
  if (cOverA != null && pattern === "ZIGZAG" && cOverA > 1.618)
    text += ` · kanonische C-Ziele durchschritten`;

  // ── Strukturpunkte fuer den Chart (A-B-C oder W-X-Y) ──
  const legPoints: { label: string; date: string; price: number }[] = [];
  if (ctx && ctx.aDate && ctx.bDate) {
    const isWXY = pattern === "KOMBINATION";
    const cDate = findExtremeDate(ctx.candles, ctx.bDate, dir);
    legPoints.push({ label: isWXY ? "W" : "A", date: ctx.aDate, price: aExtreme });
    legPoints.push({ label: isWXY ? "X" : "B", date: ctx.bDate, price: bExtreme });
    if (cExtremeSoFar != null && cDate) {
      legPoints.push({ label: isWXY ? "Y" : "C", date: cDate, price: cExtremeSoFar });
    }
  }

  // WXY-Ziel: Y ~ W in Länge (log), ab X projiziert (Kombinationen sind
  // oft laengengleich; Koenz: X-Retrace 0.786-1.382). Ersetzt das ZZ-Ziel.
  if (pattern === "KOMBINATION" && logOk) {
    const wLenLog = dir * (Math.log(w5Price) - Math.log(aExtreme));
    for (const k of [1.0, 1.236, 1.618]) {
      const level = Math.exp(Math.log(bExtreme) - dir * k * wLenLog);
      if (level > 0 && dir * (currentPrice - level) > 0) {
        targetPrice = level;
        targetLabel = `WXY-Ziel logY=${k}·W (KO-6)`;
        break;
      }
    }
  }

  return { pattern, text, targetPrice, targetLabel, cOverA, legPoints };
}

/** Extrem-Datum (Tief bei dir=1, Hoch bei dir=-1) ab startDate. */
function findExtremeDate(candles: Candle[], startDate: string, dir: 1 | -1): string | null {
  const seg = candles.filter((c) => c.date > startDate);
  if (seg.length === 0) return null;
  let best = seg[0];
  for (const k of seg) {
    const v = dir === 1 ? k.low : k.high;
    const bv = dir === 1 ? best.low : best.high;
    if (dir === 1 ? v < bv : v > bv) best = k;
  }
  return best.date;
}

interface TriangleRead {
  legs: number;
  aHeightLog: number;
  lastPrice: number;
}

/** KO-5: >=4 alternierende Beine nach B, monoton schrumpfend (log). */
function detectTriangleLegs(pivots: Pivot[], bDate: string, dir: 1 | -1): TriangleRead | null {
  const post = pivots.filter((p) => p.date >= bDate);
  if (post.length < 5) return null;
  const lens: number[] = [];
  for (let i = 1; i < post.length; i++) {
    if (post[i].kind === post[i - 1].kind) return null; // muss alternieren
    lens.push(Math.abs(Math.log(post[i].price) - Math.log(post[i - 1].price)));
  }
  if (lens.length < 4) return null;
  for (let i = 1; i < lens.length; i++) {
    if (!(lens[i] < lens[i - 1] * 0.95)) return null; // strikt kontrahierend
  }
  return {
    legs: lens.length,
    aHeightLog: lens[0],
    lastPrice: post[post.length - 1].price,
  };
}
