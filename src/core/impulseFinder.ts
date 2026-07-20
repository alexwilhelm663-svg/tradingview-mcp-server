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

export type SubVerdict = "IMPULSIVE" | "UNKLAR";

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
 * UNKLAR    = Segment zu kurz oder kein sauberer 5er (V124: Diagonalen
 *             werden nicht mehr geführt).
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
  // V124: Diagonal-Klasse per Nutzer-Erlass verworfen - das Urteil kennt
  // nur noch IMPULSIVE oder UNKLAR.
  return "UNKLAR";
}

/**
 * Fenster-Rand-Extrem-Synthese (V117.4): Der ZigZag committet das
 * Startextrem einer Serie konstruktionsbedingt nie als Pivot. Wandert das
 * rollende 5-Jahres-Fenster ueber ein Zyklus-Extrem, verliert die Doktrin
 * ihren Anker (PYPL: 310,16 -> 296,70) - und jedes Walk-Forward-Fenster
 * wuerde denselben Drift erleiden. Fix analog zum Diagonal-Ursprung (V116):
 * Liegt das Fenster-Maximum/-Minimum VOR dem ersten Pivot und wird von
 * keinem Pivot erreicht, wird es als synthetisches Rand-Pivot vorangestellt
 * (Alternation zum ersten echten Pivot bleibt gewahrt).
 */
function augmentEdgeExtremes(pivots: Pivot[], candles: Candle[]): Pivot[] {
  if (pivots.length === 0 || candles.length === 0) return pivots;
  const head = candles.slice(0, pivots[0].index + 1);
  if (head.length < 2) return pivots;

  let hiIdx = 0;
  let loIdx = 0;
  for (let i = 1; i < head.length; i++) {
    if (head[i].high > head[hiIdx].high) hiIdx = i;
    if (head[i].low < head[loIdx].low) loIdx = i;
  }
  const winHi = head[hiIdx].high;
  const winLo = head[loIdx].low;
  const maxPivH = Math.max(...pivots.filter((p) => p.kind === "H").map((p) => p.price), -Infinity);
  const minPivL = Math.min(...pivots.filter((p) => p.kind === "L").map((p) => p.price), Infinity);

  const out = [...pivots];
  const firstKind = out[0].kind;
  // Nur EIN Rand-Extrem synthetisieren - das, das die Alternation zum
  // ersten echten Pivot wahrt und ein echtes Fenster-Extrem ist.
  if (firstKind === "L" && winHi > maxPivH) {
    out.unshift({ index: hiIdx, date: head[hiIdx].date, price: winHi, kind: "H" });
  } else if (firstKind === "H" && winLo < minPivL) {
    out.unshift({ index: loIdx, date: head[loIdx].date, price: winLo, kind: "L" });
  }
  return out;
}

export function findImpulseAdaptive(candles: Candle[]): AdaptiveOutcome {
  // V117.1 "Best-ueber-Stufen": ALLE Aufloesungen werden ausgewertet.
  // Unter den Doktrin-Treffern gewinnt der hoechste Score; bei Gleichstand
  // die groebere Stufe (Makro-Praeferenz). Fallbacks nur, wenn keine
  // Doktrin-Zaehlung existiert (DK-7-Schwelle unveraendert).
  let bestDoctrine: AdaptiveImpulse | null = null;
  let bestFallback: AdaptiveImpulse | null = null;

  for (const threshold of [25, 18, 12, 8]) {
    const pivots = augmentEdgeExtremes(zigzag(candles, threshold), candles);
    if (pivots.length < 6) continue;

    const result = findBestImpulse(pivots);

    if (!result) continue;

    result.count.analysis += ` · ZigZag ${threshold}%`;
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
    : `Keine regelkonforme Impulszählung auf keiner ZigZag-Stufe (25/18/12/8 %) ableitbar (DK-7).`;
  return { impulse: null, abstention };
}

/** Extensionstyp einer fertigen Zaehlung (fuer typbewusste Checks). */
export function extensionType(points: WavePoint[], dir: 1 | -1): 1 | 3 | 5 | null {
  const P = (l: string) => points.find((x) => x.label === l);
  const w0 = P("0"), w1 = P("1"), w2 = P("2"), w3 = P("3"), w4 = P("4"), w5 = P("5");
  if (!w0 || !w1 || !w2 || !w3 || !w4 || !w5) return null;
  const ln = (p: { price: number }): number => dir * Math.log(p.price);
  const L1 = ln(w1) - ln(w0), L3 = ln(w3) - ln(w2), L5 = ln(w5) - ln(w4);
  const arr = [L1, L3, L5];
  const maxI = arr.indexOf(Math.max(...arr));
  return maxI === 0 ? 1 : maxI === 1 ? 3 : 5;
}

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

  const found: { seq: Pivot[]; score: number; key: number[] }[] = [];

  // O(k^2)-Suche (V119): Unter Segment-Extrem-Pflicht sind w1/w3/w5 fuer
  // gegebene (w2, w4) DETERMINIERT (Bereichs-Maxima). Freiheitsgrade sind
  // nur die beiden Korrektur-Pivots - beweisbar aequivalent zur alten
  // O(k^5)-Enumeration, Reihenfolge ueber Index-Tupel repliziert.
  const maxIn = (from: number, to: number): Pivot | null => {
    let m: Pivot | null = null;
    for (const x of imp) {
      if (x.index <= from || x.index >= to) continue;
      if (!m || v(x) > v(m)) m = x;
    }
    return m;
  };
  const maxAfter = (from: number): Pivot | null => {
    let m: Pivot | null = null;
    for (const x of imp) {
      if (x.index <= from) continue;
      if (!m || v(x) > v(m)) m = x;
    }
    return m;
  };

  for (let a = 0; a < cor.length; a++) {
    const w2 = cor[a];
    if (v(w2) <= v(w0)) continue; // HR-1
    const w1 = maxIn(w0.index, w2.index);
    if (!w1 || v(w1) <= v(w0)) continue;
    for (let b = a + 1; b < cor.length; b++) {
      const w4 = cor[b];
      const w3 = maxIn(w2.index, w4.index);
      if (!w3) continue;
      if (v(w3) <= v(w1)) continue; // HR-4
      if (v(w4) <= v(w1)) continue; // HR-3 (Overlap-Verbot)
      // HR-6 (V120, Koenz/EWI; V123 auf LOG umgestellt): W4 retraced nie
      // mehr als 0.618 der W3 - gemessen im Doktrin-Raum (DK-2). Die
      // lineare Lesart verwarf kanonische Makro-Zaehlungen (BTC 2022:
      // linear 0.81, log 0.48).
      const retr4log = (ln(w3) - ln(w4)) / (ln(w3) - ln(w2));
      if (retr4log > 0.618) continue;
      // w2 muss das Korrektur-Extrem in (w1, w3) sein
      if (cor.some((x) => x.index > w1.index && x.index < w3.index && v(x) < v(w2))) continue;
      const w5 = maxAfter(w4.index);
      if (!w5) continue;
      if (v(w5) <= v(w3)) continue; // Trunkierungs-Verbot
      // w4 muss das Korrektur-Extrem in (w3, w5) sein
      if (cor.some((x) => x.index > w3.index && x.index < w5.index && v(x) < v(w4))) continue;

      const L1 = ln(w1) - ln(w0);
      const L3 = ln(w3) - ln(w2);
      const L5 = ln(w5) - ln(w4);
      if (L3 <= Math.min(L1, L5)) continue; // HR-2: W3 nie die kuerzeste
      // HR-7 (V123) Grad-Konsistenz, Preis UND Zeit: Eine echte Extension
      // streckt den Preis, nicht den Wellengrad. Grad-Vermischung liegt
      // vor, wenn die laengste Antriebswelle die zweitlaengste im PREIS
      // um > 2.0x UND in der ZEIT um > 4.236x uebertrifft (BTC-max-Befund:
      // 0-4 als Randstaub, "W5" = ganzer Zyklus). Harte Obergrenze im
      // Preis bleibt 4.236x (jenseits jeder kanonischen Extension).
      const srt = [L1, L3, L5].sort((a, b) => b - a);
      if (srt[0] > 4.236 * srt[1]) continue;
      const d1 = w1.index - w0.index;
      const d3 = w3.index - w2.index;
      const d5 = w5.index - w4.index;
      const ds = [d1, d3, d5].sort((a, b) => b - a);
      if (srt[0] > 2.0 * srt[1] && ds[0] > 4.236 * Math.max(1, ds[1])) continue;

      const seq = [w0, w1, w2, w3, w4, w5];
      const score = scoreImpulse(seq, pivots, dir, isDoctrine);
      found.push({
        seq,
        score,
        key: [w1.index, w2.index, w3.index, w4.index, w5.index],
      });
    }
  }

  if (found.length === 0) return [];
  // Stabil: Score absteigend, bei Gleichstand lexikographisch nach
  // Index-Tupel (repliziert die alte Entdeckungsreihenfolge exakt).
  const cmpKey = (x: number[], y: number[]): number => {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  found.sort((a, b) => b.score - a.score || cmpKey(a.key, b.key));
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
  // Retrace-Guidelines. BEWUSST typ-UNabhaengig (Ablation V120): Die
  // Koenz-Typ-Baender in der SELEKTION senkten die Walk-Forward-Expectancy
  // (5.0->3.3%, Score>=3 12.6->6.1%). Sie leben als Qualitaets-Info (GL-2b),
  // nicht als Auswahl-Kriterium.
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
