import type { Pivot } from "./zigzag";

export type CorrectionPattern =
  | "ZIGZAG"
  | "FLAT_REGULAR"
  | "FLAT_EXPANDED"
  | "UNKLAR";

export interface CorrectionRead {
  pattern: CorrectionPattern;
  bRetr: number;
  cOverA: number | null;
  targetPrice: number | null;
  targetLabel: string | null;
  triangleSuspect: boolean;
  text: string;
}

/**
 * Korrektur-Klassifikator (V115, KO-2/KO-3/KO-4):
 * Deterministische Lesart der laufenden Korrektur ueber das B/A-Retracement:
 *   B >= 0,9 x A            -> FLAT (KO-3); B ueber Impuls-Top -> EXPANDED
 *   B in 0,382..0,786       -> ZIGZAG (KO-2)
 *   dazwischen              -> UNKLAR (Grauzone)
 * Das musterabhaengige kanonische C-Ziel wird als zusaetzlicher
 * Level-Kandidat in die Konfluenz-Cluster injiziert ("KO-Ziel") -
 * bereits durchschrittene Ziele werden ehrlich als solche gemeldet.
 * Triangle (KO-4) nur als Verdachts-Hinweis: >= 4 kontrahierende
 * Beine nach B bei begrenzter Nettodrift.
 */
export function classifyCorrection(
  w5Price: number,
  aExtreme: number, // dir=1: A-Tief | dir=-1: A-Hoch
  bExtreme: number, // dir=1: B-Hoch | dir=-1: B-Tief
  cExtremeSoFar: number | null,
  currentPrice: number,
  postTopPivots: Pivot[],
  dir: 1 | -1 = 1 // 1 = Korrektur abwaerts (nach bullischem Impuls), -1 = aufwaerts
): CorrectionRead {
  const A = dir * (w5Price - aExtreme);
  const bRetr = A > 0 ? (dir * (bExtreme - aExtreme)) / A : 0;
  const cOverA =
    A > 0 && cExtremeSoFar != null ? (dir * (bExtreme - cExtremeSoFar)) / A : null;

  let pattern: CorrectionPattern;
  if (bRetr >= 0.9)
    pattern = dir * (bExtreme - w5Price) > Math.abs(w5Price) * 0.005 ? "FLAT_EXPANDED" : "FLAT_REGULAR";
  else if (bRetr >= 0.382 && bRetr <= 0.786) pattern = "ZIGZAG";
  else pattern = "UNKLAR";

  // Kanonische C-Ziele (KO-2/KO-3), gemessen ab B
  const kSet =
    pattern === "FLAT_EXPANDED" ? [1.618, 2.618]
    : pattern === "FLAT_REGULAR" ? [1.0, 1.236]
    : pattern === "ZIGZAG" ? [1.0, 1.618]
    : [1.0, 1.618];

  let targetPrice: number | null = null;
  let targetLabel: string | null = null;
  for (const k of kSet) {
    const level = bExtreme - dir * k * A;
    if (level > 0 && dir * (currentPrice - level) > 0) {
      targetPrice = level;
      targetLabel = `KO-Ziel C=${k}·A (${pattern === "ZIGZAG" ? "KO-2" : "KO-3"})`;
      break;
    }
  }

  // Triangle-Verdacht (KO-4): kontrahierende Beine nach dem B-Extrem
  const tail = postTopPivots.slice(-6);
  let contracting = 0;
  for (let i = 2; i < tail.length; i++) {
    const legPrev = Math.abs(tail[i - 1].price - tail[i - 2].price);
    const legCurr = Math.abs(tail[i].price - tail[i - 1].price);
    if (legCurr < legPrev) contracting++;
    else contracting = 0;
  }
  const prices = tail.map((p) => p.price);
  const mid = prices.length > 0 ? (Math.max(...prices) + Math.min(...prices)) / 2 : 0;
  const drift =
    prices.length >= 4 && mid > 0
      ? Math.abs(prices[prices.length - 1] - prices[0]) / mid
      : 1;
  const triangleSuspect = contracting >= 3 && drift < 0.12;

  const patternName: Record<CorrectionPattern, string> = {
    ZIGZAG: "Zigzag (KO-2)",
    FLAT_REGULAR: "Regular Flat (KO-3)",
    FLAT_EXPANDED: "Expanded Flat (KO-3)",
    UNKLAR: "unklar (Grauzone 0,786–0,9)",
  };
  let text = `Korrektur-Lesart: ${patternName[pattern]} · B = ${bRetr.toFixed(2)}×A`;
  if (cOverA != null) text += ` · C bisher ${cOverA.toFixed(2)}×A`;
  if (targetPrice != null) text += ` · präferiertes C-Ziel ${targetPrice.toFixed(2)}`;
  else if (cOverA != null && cOverA > Math.max(...kSet))
    text += ` · kanonische C-Ziele durchschritten`;
  if (triangleSuspect) text += ` · ⚠️ Triangle-Verdacht (KO-4)`;

  return { pattern, bRetr, cOverA, targetPrice, targetLabel, triangleSuspect, text };
}
