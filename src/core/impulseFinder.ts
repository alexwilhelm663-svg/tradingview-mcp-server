import { zigzag, Pivot } from "./zigzag";
import type { Candle } from "./marketData";

export interface WavePoint {
  label: string;
  date: string;
  price: number;
}

export interface WaveCount {
  trend: "bullish" | "bearish";
  points: WavePoint[];
  analysis: string;
}

export interface ImpulseResult {
  count: WaveCount;
  score: number;
  maxScore: number;
  doctrineAnchor: boolean;
}

export interface AdaptiveImpulse {
  result: ImpulseResult;
  pivots: Pivot[];
  threshold: number;
}

/**
 * Aufloesungs-Leiter (V113.1): Der fixe 25%-ZigZag ist an High-Beta-Titeln
 * geeicht - Low-Vol-Megacaps (AAPL: ~3-4% Wochen-ATR) liefern damit zu
 * wenige Pivots fuer ein 6-Punkte-Skelett. Die Leiter verfeinert die
 * Aufloesung NUR, wenn die groebere Stufe keinen Impuls findet:
 * Alles, was bei 25% funktioniert, bleibt byte-identisch.
 */
export function findImpulseAdaptive(candles: Candle[]): AdaptiveImpulse | null {
  for (const threshold of [25, 18, 12, 8]) {
    const pivots = zigzag(candles, threshold);
    if (pivots.length < 6) continue;
    const result = findBestImpulse(pivots);
    if (result) {
      result.count.analysis += ` · ZigZag ${threshold}%`;
      return { result, pivots, threshold };
    }
  }
  return null;
}

/**
 * Deterministische Impulszaehlung (V113, ElliotEugen-Prinzip):
 * Statt ein LLM raten zu lassen, werden alle chronologisch-alternierenden
 * Pivot-Sequenzen (0,1,2,3,4,5) enumeriert, die die HARTEN Regeln erfuellen:
 *   - W2 retraced W1 nie zu 100% (W2 ueber W0)
 *   - W3 ueberschreitet das Ende von W1 und ist nie die kuerzeste Antriebswelle
 *   - W4 ueberlappt W1 nicht
 *   - keine Trunkierung (W5 ueber W3)
 *   - Segment-Extrem-Bedingung: jeder Wellenpunkt ist das Extrem seines Segments
 * Die beste Sequenz gewinnt per Fib-Guideline-Scoring (Log-Space, saekulare
 * Doktrin). Kein Ausweichen, kein Reward-Hacking, keine API-Quota.
 */
export function findBestImpulse(pivots: Pivot[]): ImpulseResult | null {
  if (pivots.length < 6) return null;

  const minL = extremeOf(pivots, "L", Math.min);
  const maxH = extremeOf(pivots, "H", Math.max);
  if (!minL || !maxH) return null;

  // Richtungs-Heuristik: kommt das globale Tief vor dem globalen Hoch,
  // ist der Makro-Zyklus bullish - sonst bearish. Fallback: Gegenrichtung.
  const primary: 1 | -1 = minL.index < maxH.index ? 1 : -1;
  return (
    searchDirection(pivots, primary) ?? searchDirection(pivots, (primary * -1) as 1 | -1)
  );
}

function extremeOf(
  pivots: Pivot[],
  kind: "H" | "L",
  cmp: (...v: number[]) => number
): Pivot | null {
  const pool = pivots.filter((p) => p.kind === kind);
  if (pool.length === 0) return null;
  const target = cmp(...pool.map((p) => p.price));
  return pool.find((p) => p.price === target) ?? null;
}

function searchDirection(pivots: Pivot[], dir: 1 | -1): ImpulseResult | null {
  const startKind = dir === 1 ? "L" : "H";
  const doctrineAnchor =
    dir === 1
      ? extremeOf(pivots, "L", Math.min)
      : extremeOf(pivots, "H", Math.max);
  if (!doctrineAnchor) return null;

  // Doktrin-Anker zuerst; andere Anker nur als Fallback (mit Score-Malus).
  const anchors = [
    doctrineAnchor,
    ...pivots.filter((p) => p.kind === startKind && p !== doctrineAnchor),
  ];

  let best: ImpulseResult | null = null;
  for (const anchor of anchors) {
    const isDoctrine = anchor === doctrineAnchor;
    const res = searchFromAnchor(pivots, anchor, dir, isDoctrine);
    if (res && (!best || res.score > best.score)) best = res;
    // Doktrin-Anker gefunden -> Fallback-Anker nur noch pruefen, wenn nichts da
    if (best && isDoctrine) break;
  }
  return best;
}

function searchFromAnchor(
  pivots: Pivot[],
  w0: Pivot,
  dir: 1 | -1,
  isDoctrine: boolean
): ImpulseResult | null {
  const impKind = dir === 1 ? "H" : "L"; // 1/3/5
  const corKind = dir === 1 ? "L" : "H"; // 2/4
  const after = pivots.filter((p) => p.index > w0.index);
  const imp = after.filter((p) => p.kind === impKind);
  const cor = after.filter((p) => p.kind === corKind);

  // Vorzeichen-neutraler Vergleich: v(dir=1) = Preis, v(dir=-1) = -Preis
  const v = (p: Pivot): number => dir * p.price;
  const ln = (p: Pivot): number => dir * Math.log(p.price);

  let best: { seq: Pivot[]; score: number } | null = null;

  for (const w1 of imp) {
    if (v(w1) <= v(w0)) continue;
    for (const w2 of cor.filter((p) => p.index > w1.index)) {
      if (v(w2) <= v(w0)) continue; // W2 > 100%-Retrace verboten
      for (const w3 of imp.filter((p) => p.index > w2.index)) {
        if (v(w3) <= v(w1)) continue; // W3 muss W1-Ende ueberschreiten
        for (const w4 of cor.filter((p) => p.index > w3.index)) {
          if (v(w4) <= v(w1)) continue; // Overlap-Verbot
          for (const w5 of imp.filter((p) => p.index > w4.index)) {
            if (v(w5) <= v(w3)) continue; // Trunkierungs-Verbot
            const seq = [w0, w1, w2, w3, w4, w5];
            if (!segmentExtremesOk(seq, pivots, dir)) continue;

            const L1 = ln(w1) - ln(w0);
            const L3 = ln(w3) - ln(w2);
            const L5 = ln(w5) - ln(w4);
            if (L3 <= Math.min(L1, L5)) continue; // W3 nie die kuerzeste

            const score = scoreImpulse(seq, pivots, dir, isDoctrine);
            if (!best || score > best.score) best = { seq, score };
          }
        }
      }
    }
  }

  if (!best) return null;
  const [w0p, w1p, w2p, w3p, w4p, w5p] = best.seq;
  const points: WavePoint[] = best.seq.map((p, i) => ({
    label: String(i),
    date: p.date,
    price: p.price,
  }));
  const lnp = (p: Pivot): number => dir * Math.log(p.price);
  const L1 = lnp(w1p) - lnp(w0p);
  const L3 = lnp(w3p) - lnp(w2p);
  const retr2 = (lnp(w1p) - lnp(w2p)) / L1;
  const retr4 = (lnp(w3p) - lnp(w4p)) / L3;

  const trend = dir === 1 ? "bullish" : "bearish";
  const analysis =
    `🧮 Deterministische Zählung (Score ${best.score}/${MAX_SCORE}${isDoctrine ? ", Doktrin-Anker" : ", Fallback-Anker"}): ` +
    `W3 = ${(L3 / L1).toFixed(2)}×W1 (log) · W2-Retrace ${retr2.toFixed(2)} · W4-Retrace ${retr4.toFixed(2)}`;

  return {
    count: { trend, points, analysis },
    score: best.score,
    maxScore: MAX_SCORE,
    doctrineAnchor: isDoctrine,
  };
}

/** Jeder Wellenpunkt muss das Extrem seines Segments sein. */
function segmentExtremesOk(seq: Pivot[], pivots: Pivot[], dir: 1 | -1): boolean {
  const [w0, w1, w2, w3, w4, w5] = seq;
  const v = (p: Pivot): number => dir * p.price;
  const between = (a: Pivot, b: Pivot, kind: "H" | "L"): Pivot[] =>
    pivots.filter((p) => p.index > a.index && p.index < b.index && p.kind === kind);

  const impKind = dir === 1 ? "H" : "L";
  const corKind = dir === 1 ? "L" : "H";

  if (between(w0, w2, impKind).some((p) => v(p) > v(w1))) return false;
  if (between(w1, w3, corKind).some((p) => v(p) < v(w2))) return false;
  if (between(w2, w4, impKind).some((p) => v(p) > v(w3))) return false;
  if (between(w3, w5, corKind).some((p) => v(p) < v(w4))) return false;
  // W5 = Extrem des Rests: kein spaeterer Impuls-Pivot darf W5 ueberschreiten
  if (pivots.some((p) => p.index > w4.index && p.kind === impKind && v(p) > v(w5)))
    return false;
  return true;
}

const MAX_SCORE = 12;

/** Fib-Guideline-Scoring (Log-Space): Extension, Retrace-Zonen, Alternation, Gleichheit, Doktrin. */
function scoreImpulse(seq: Pivot[], pivots: Pivot[], dir: 1 | -1, isDoctrine: boolean): number {
  const [w0, w1, w2, w3, w4, w5] = seq;
  const ln = (p: Pivot): number => dir * Math.log(p.price);
  const L1 = ln(w1) - ln(w0);
  const L3 = ln(w3) - ln(w2);
  const L5 = ln(w5) - ln(w4);
  const retr2 = (ln(w1) - ln(w2)) / L1;
  const retr4 = (ln(w3) - ln(w4)) / L3;
  let s = 0;

  // Welle-3-Extension
  if (L3 >= 1.618 * L1) s += 2;
  else if (L3 > L1) s += 1;
  // Retrace-Guidelines
  if (retr2 >= 0.5 && retr2 <= 0.786) s += 2;
  else if (retr2 >= 0.382 && retr2 <= 0.9) s += 1;
  if (retr4 >= 0.236 && retr4 <= 0.5) s += 2;
  else if (retr4 <= 0.618) s += 1;
  // Alternation
  if (Math.abs(retr2 - retr4) >= 0.15) s += 1;
  // Gleichheit / 0.618-Relation von W5 zu W1 (bei W3-Extension)
  if (Math.abs(L5 - L1) / L1 < 0.15 || Math.abs(L5 - 0.618 * L1) / (0.618 * L1) < 0.15) s += 1;
  // Doktrin: Anker am globalen Extrem, W5 am gegenueberliegenden Extrem
  if (isDoctrine) s += 2;
  const oppExtreme =
    dir === 1 ? extremeOf(pivots, "H", Math.max) : extremeOf(pivots, "L", Math.min);
  if (oppExtreme && oppExtreme.index === w5.index) s += 2;

  return s;
}
