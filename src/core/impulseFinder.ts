import { zigzag, Pivot } from "./zigzag";
import { detectDiagonal } from "./diagonal";
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

export interface AdaptiveOutcome {
  impulse: AdaptiveImpulse | null;
  abstention: string | null;
}

// DK-7 Enthaltungs-Gebot: Fallback-Anker-Zaehlungen unterhalb dieser
// Schwelle werden verworfen - lieber keine Zaehlung als eine erzwungene.
const MIN_FALLBACK_SCORE = 8;

export interface PartialImpulse {
  points: WavePoint[];
  lastLabel: string;
  trend: "bullish" | "bearish";
}

/**
 * Teil-Zaehlung (V118): enumeriert regelkonforme, aber UNVOLLSTAENDIGE
 * Sequenzen (0-1, 0..3, 0..4) - fuer laufende Impulse, deren spaetere
 * Wellen noch nicht existieren. Auswahl bewusst schlicht (L3/L1): fuer
 * die Sub-Positionsbestimmung genuegt die grobe Praeferenz, die volle
 * Guideline-Bewertung bleibt dem 0-5-Finder vorbehalten.
 */
export function findPartialImpulse(
  pivots: Pivot[],
  dir: 1 | -1,
  targetLen: 2 | 4 | 5
): PartialImpulse | null {
  if (pivots.length < targetLen) return null;
  const impKind = dir === 1 ? "H" : "L";
  const corKind = dir === 1 ? "L" : "H";
  const v = (p: Pivot): number => dir * p.price;
  const ln = (p: Pivot): number => dir * Math.log(p.price);

  const pool = pivots.filter((p) => p.kind === corKind);
  if (pool.length === 0) return null;
  const w0 = pool.reduce((m, x) => (v(x) < v(m) ? x : m)); // Doktrin-Anker

  const after = pivots.filter((p) => p.index > w0.index);
  const imp = after.filter((p) => p.kind === impKind);
  const cor = after.filter((p) => p.kind === corKind);

  const mk = (seq: Pivot[]): PartialImpulse => ({
    points: seq.map((x, i) => ({ label: String(i), date: x.date, price: x.price })),
    lastLabel: String(seq.length - 1),
    trend: dir === 1 ? "bullish" : "bearish",
  });

  if (targetLen === 2) {
    if (imp.length === 0) return null;
    const w1 = imp.reduce((m, x) => (v(x) > v(m) ? x : m));
    return v(w1) > v(w0) ? mk([w0, w1]) : null;
  }

  let best: { seq: Pivot[]; score: number } | null = null;
  for (const w1 of imp) {
    if (v(w1) <= v(w0)) continue;
    for (const w2 of cor.filter((x) => x.index > w1.index)) {
      if (v(w2) <= v(w0)) continue; // HR-1
      if (imp.some((x) => x.index > w0.index && x.index < w2.index && v(x) > v(w1))) continue;
      for (const w3 of imp.filter((x) => x.index > w2.index)) {
        if (v(w3) <= v(w1)) continue; // HR-4
        if (cor.some((x) => x.index > w1.index && x.index < w3.index && v(x) < v(w2))) continue;
        const L1 = ln(w1) - ln(w0);
        const L3 = ln(w3) - ln(w2);
        if (L1 <= 0 || L3 <= 0) continue;
        const s = L3 / L1;

        if (targetLen === 4) {
          // W3 ist die laufende Spitze
          if (imp.some((x) => x.index > w3.index && v(x) > v(w3))) continue;
          if (!best || s > best.score) best = { seq: [w0, w1, w2, w3], score: s };
        } else {
          for (const w4 of cor.filter((x) => x.index > w3.index)) {
            if (v(w4) <= v(w1)) continue; // HR-3
            // Existiert danach ein hoeheres Impuls-Pivot, waere die Zaehlung vollstaendig
            if (imp.some((x) => x.index > w4.index && v(x) > v(w3))) continue;
            if (!best || s > best.score) best = { seq: [w0, w1, w2, w3, w4], score: s };
          }
        }
      }
    }
  }
  return best ? mk(best.seq) : null;
}

export type SubVerdict = "IMPULSIVE" | "DIAGONAL" | "UNKLAR";

/** Feinere ZigZag-Stufen fuer Sub-Analysen, relativ zur Eltern-Stufe. */
export function subThresholds(parent: number): number[] {
  const ladder = [
    Math.round(parent * 0.6),
    Math.round(parent * 0.4),
    Math.round(parent * 0.25),
  ].map((x) => Math.max(3, x));
  return [...new Set(ladder)];
}

/**
 * Substruktur-Urteil eines Wellensegments (V117.3):
 * IMPULSIVE = regelkonformer 5-Teiler auf einer Sub-Stufe gefunden;
 * DIAGONAL  = kein Impuls, aber kanonischer Keil (detectDiagonal);
 * UNKLAR    = Segment zu kurz oder weder-noch.
 */
export function segmentVerdict(
  candles: Candle[],
  fromDate: string,
  toDate: string,
  dir: 1 | -1,
  parentThreshold: number
): SubVerdict {
  const seg = candles.filter((c) => c.date >= fromDate && c.date <= toDate);
  if (seg.length < 15) return "UNKLAR";
  for (const th of subThresholds(parentThreshold)) {
    const piv = zigzag(seg, th);
    if (piv.length < 6) continue;
    const sub = findBestImpulse(piv);
    if (sub && sub.count.trend === (dir === 1 ? "bullish" : "bearish")) return "IMPULSIVE";
  }
  return detectDiagonal(seg, dir) ? "DIAGONAL" : "UNKLAR";
}

/**
 * Aufloesungs-Leiter (V113.1): Der fixe 25%-ZigZag ist an High-Beta-Titeln
 * geeicht - Low-Vol-Megacaps (AAPL: ~3-4% Wochen-ATR) liefern damit zu
 * wenige Pivots fuer ein 6-Punkte-Skelett. Die Leiter verfeinert die
 * Aufloesung NUR, wenn die groebere Stufe keinen Impuls findet:
 * Alles, was bei 25% funktioniert, bleibt byte-identisch.
 */
export function findImpulseAdaptive(candles: Candle[]): AdaptiveOutcome {
  // V117.1 "Best-ueber-Stufen": ALLE Aufloesungen werden ausgewertet.
  // Unter den Doktrin-Treffern gewinnt der hoechste Score; bei Gleichstand
  // die groebere Stufe (Makro-Praeferenz). Fallbacks nur, wenn keine
  // Doktrin-Zaehlung existiert (DK-7-Schwelle unveraendert).
  let bestDoctrine: AdaptiveImpulse | null = null;
  let bestFallback: AdaptiveImpulse | null = null;

  let dk8Filtered = 0;
  for (const threshold of [25, 18, 12, 8]) {
    const pivots = zigzag(candles, threshold);
    if (pivots.length < 6) continue;

    // DK-8 "Klare-Impuls-Pflicht": Kandidaten, deren W3-Segment diagonal
    // statt impulsiv aufloest, sind unzulaessig (Diagonal-Positionen sind
    // nur 1/A/5/C, HR-5). Walk-down ueber die Top-5 der Stufe.
    let result: ImpulseResult | null = null;
    let skipped = 0;
    for (const cand of findRankedImpulses(pivots, 5)) {
      const w2 = cand.count.points.find((x) => x.label === "2");
      const w3 = cand.count.points.find((x) => x.label === "3");
      const dir: 1 | -1 = cand.count.trend === "bullish" ? 1 : -1;
      if (
        w2 &&
        w3 &&
        segmentVerdict(candles, w2.date, w3.date, dir, threshold) === "DIAGONAL"
      ) {
        skipped++;
        continue;
      }
      result = cand;
      break;
    }
    dk8Filtered += skipped;
    if (!result) continue;

    result.count.analysis += ` · ZigZag ${threshold}%`;
    if (skipped > 0) result.count.analysis += ` · DK-8: ${skipped} Diagonal-W3-Kandidat(en) verworfen`;
    const hit: AdaptiveImpulse = { result, pivots, threshold };

    if (result.doctrineAnchor) {
      if (!bestDoctrine || result.score > bestDoctrine.result.score) bestDoctrine = hit;
    } else {
      if (!bestFallback || result.score > bestFallback.result.score) bestFallback = hit;
    }
  }

  if (bestDoctrine) return { impulse: bestDoctrine, abstention: null };

  if (bestFallback && bestFallback.result.score >= MIN_FALLBACK_SCORE) {
    return { impulse: bestFallback, abstention: null };
  }

  // DK-7: ehrliche Enthaltung mit Begruendung
  const abstention = bestFallback
    ? `Keine belastbare Impulszählung im Analysefenster: Doktrin-Anker liefert keine regelkonforme Sequenz, ` +
      `beste Fallback-Kandidatin erreicht nur Score ${bestFallback.result.score}/${bestFallback.result.maxScore} ` +
      `(Schwelle: ${MIN_FALLBACK_SCORE}, DK-7). Struktur vermutlich korrektiv oder im Übergang.`
    : dk8Filtered > 0
      ? `Keine klare Impulszählung: ${dk8Filtered} Kandidat(en) wegen diagonaler W3-Substruktur verworfen (DK-8/HR-5) und keine regelkonforme Alternative gefunden.`
      : `Keine regelkonforme Impulszählung auf keiner ZigZag-Stufe (25/18/12/8 %) ableitbar (DK-7).`;
  return { impulse: null, abstention };
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
  return findRankedImpulses(pivots, 1)[0] ?? null;
}

/** Top-N regelkonforme Zaehlungen (fuer den DK-8-Walk-down). */
export function findRankedImpulses(pivots: Pivot[], limit = 5): ImpulseResult[] {
  if (pivots.length < 6) return [];

  const minL = extremeOf(pivots, "L", Math.min);
  const maxH = extremeOf(pivots, "H", Math.max);
  if (!minL || !maxH) return [];

  const primary: 1 | -1 = minL.index < maxH.index ? 1 : -1;
  const first = searchDirection(pivots, primary, limit);
  if (first.length > 0) return first;
  return searchDirection(pivots, (primary * -1) as 1 | -1, limit);
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

function searchDirection(pivots: Pivot[], dir: 1 | -1, limit: number): ImpulseResult[] {
  const startKind = dir === 1 ? "L" : "H";
  const doctrineAnchor =
    dir === 1
      ? extremeOf(pivots, "L", Math.min)
      : extremeOf(pivots, "H", Math.max);
  if (!doctrineAnchor) return [];

  // Doktrin-Anker zuerst; andere Anker nur als Fallback (mit Score-Malus).
  const anchors = [
    doctrineAnchor,
    ...pivots.filter((p) => p.kind === startKind && p !== doctrineAnchor),
  ];

  const doctrineRanked = searchFromAnchor(pivots, doctrineAnchor, dir, true, limit);
  if (doctrineRanked.length > 0) return doctrineRanked;

  let fallback: ImpulseResult[] = [];
  for (const anchor of anchors.slice(1)) {
    fallback = fallback.concat(searchFromAnchor(pivots, anchor, dir, false, limit));
  }
  fallback.sort((a, b) => b.score - a.score);
  return fallback.slice(0, limit);
}

function searchFromAnchor(
  pivots: Pivot[],
  w0: Pivot,
  dir: 1 | -1,
  isDoctrine: boolean,
  limit: number
): ImpulseResult[] {
  const impKind = dir === 1 ? "H" : "L"; // 1/3/5
  const corKind = dir === 1 ? "L" : "H"; // 2/4
  const after = pivots.filter((p) => p.index > w0.index);
  const imp = after.filter((p) => p.kind === impKind);
  const cor = after.filter((p) => p.kind === corKind);

  // Vorzeichen-neutraler Vergleich: v(dir=1) = Preis, v(dir=-1) = -Preis
  const v = (p: Pivot): number => dir * p.price;
  const ln = (p: Pivot): number => dir * Math.log(p.price);

  const found: { seq: Pivot[]; score: number; order: number }[] = [];
  let order = 0;

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
            found.push({ seq, score, order: order++ });
          }
        }
      }
    }
  }

  if (found.length === 0) return [];
  // Stabil: Score absteigend, bei Gleichstand Entdeckungsreihenfolge
  // (identisch zum alten "erster gewinnt"-Verhalten).
  found.sort((a, b) => b.score - a.score || a.order - b.order);
  return found.slice(0, limit).map(({ seq, score }) => buildResult(seq, score, dir, isDoctrine));
}

function buildResult(seqIn: Pivot[], scoreIn: number, dir: 1 | -1, isDoctrine: boolean): ImpulseResult {
  const best = { seq: seqIn, score: scoreIn };
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

  // GL-1 generalisiert (V117.1): Bonus fuer DIE eine gestreckte Welle,
  // egal ob 1, 3 oder 5 - gestreckte Erste sind an Zyklustiefs kanonisch.
  const lens = [L1, L3, L5].sort((a, b) => b - a);
  if (lens[0] >= 1.618 * lens[1]) s += 2;
  else if (lens[0] >= 1.236 * lens[1]) s += 1;
  // Retrace-Guidelines
  if (retr2 >= 0.5 && retr2 <= 0.786) s += 2;
  else if (retr2 >= 0.382 && retr2 <= 0.9) s += 1;
  if (retr4 >= 0.236 && retr4 <= 0.5) s += 2;
  else if (retr4 <= 0.618) s += 1;
  // Alternation
  if (Math.abs(retr2 - retr4) >= 0.15) s += 1;
  // GL-3: Gleichheit/0.618-Relation der beiden NICHT gestreckten Wellen
  const arr = [L1, L3, L5];
  const maxI = arr.indexOf(Math.max(...arr));
  const [ox, oy] = arr.filter((_, i) => i !== maxI);
  const near = (a: number, b: number): boolean => Math.abs(a - b) / Math.max(a, b) < 0.15;
  if (near(ox, oy) || near(ox, 0.618 * oy) || near(oy, 0.618 * ox)) s += 1;
  // Doktrin: Anker am globalen Extrem, W5 am gegenueberliegenden Extrem
  if (isDoctrine) s += 2;
  const oppExtreme =
    dir === 1 ? extremeOf(pivots, "H", Math.max) : extremeOf(pivots, "L", Math.min);
  if (oppExtreme && oppExtreme.index === w5.index) s += 2;

  return s;
}
