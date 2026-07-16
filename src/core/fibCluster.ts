export interface LevelCandidate {
  price: number;
  label: string;
}

export interface FibCluster {
  floor: number;
  ceiling: number;
  center: number;
  score: number;
  labels: string[];
}

/**
 * Alle hergeleiteten Long-Level fuer eine laufende Korrektur nach
 * abgeschlossenem Impuls 0->5:
 *  - Retracements des Gesamtimpulses (0.5 / 0.618 / 0.786 / 0.886)
 *  - W4-Zone (klassisches Korrekturziel "previous fourth wave")
 *  - C = k*A Projektionen ab B (0.618 / 1.0 / 1.236 / 1.618)
 * Skill-Prinzip: kein Level ohne Herleitung.
 */
export function longLevelCandidates(p: {
  w0: number;
  w5: number;
  w4?: number | null;
  aLow?: number | null;
  bHigh?: number | null;
}): LevelCandidate[] {
  const out: LevelCandidate[] = [];
  const imp = p.w5 - p.w0;
  // Duale Konvention: linear UND logarithmisch. Landen beide Ableitungen
  // derselben Ratio in einer Zone, ist das echte Konfluenz ueber Konventionen.
  if (imp > 0 && p.w0 > 0) {
    const logRange = Math.log(p.w5) - Math.log(p.w0);
    for (const f of [0.5, 0.618, 0.786, 0.886]) {
      out.push({ price: p.w5 - f * imp, label: `Retr ${f}` });
      out.push({ price: Math.exp(Math.log(p.w5) - f * logRange), label: `logRetr ${f}` });
    }
  }
  if (p.w4 != null && p.w4 > 0) out.push({ price: p.w4, label: "W4-Zone" });
  if (p.aLow != null && p.aLow > 0 && p.bHigh != null) {
    const A = p.w5 - p.aLow;
    const logA = Math.log(p.w5) - Math.log(p.aLow);
    if (A > 0) {
      for (const k of [0.618, 1.0, 1.236, 1.618]) {
        const lin = p.bHigh - k * A;
        if (lin > 0) out.push({ price: lin, label: `C=${k}·A` });
        out.push({ price: Math.exp(Math.log(p.bHigh) - k * logA), label: `logC=${k}·A` });
      }
    }
  }
  return out.filter((l) => l.price > 0).sort((a, b) => a.price - b.price);
}

/**
 * Gruppiert Level, die naeher als tolPct beieinanderliegen, zu Clustern.
 * Score = Anzahl konfluenter Herleitungen. Sortierung: Score, dann Preis.
 */
/**
 * Spiegel von longLevelCandidates (V117): Widerstands-Level fuer die
 * Aufwaertskorrektur nach vollendetem BEARISHEN Impuls (w0 oben, w5 unten).
 */
export function shortLevelCandidates(p: {
  w0: number;
  w5: number;
  w4?: number | null;
  aHigh?: number | null;
  bLow?: number | null;
}): LevelCandidate[] {
  const out: LevelCandidate[] = [];
  const imp = p.w0 - p.w5;
  if (imp > 0 && p.w5 > 0) {
    const logRange = Math.log(p.w0) - Math.log(p.w5);
    for (const f of [0.5, 0.618, 0.786, 0.886]) {
      out.push({ price: p.w5 + f * imp, label: `Retr ${f}` });
      out.push({ price: Math.exp(Math.log(p.w5) + f * logRange), label: `logRetr ${f}` });
    }
  }
  if (p.w4 != null && p.w4 > 0) out.push({ price: p.w4, label: "W4-Zone" });
  if (p.aHigh != null && p.bLow != null && p.bLow > 0) {
    const A = p.aHigh - p.w5;
    const logA = Math.log(p.aHigh) - Math.log(p.w5);
    if (A > 0) {
      for (const k of [0.618, 1.0, 1.236, 1.618]) {
        out.push({ price: p.bLow + k * A, label: `C=${k}·A` });
        out.push({ price: Math.exp(Math.log(p.bLow) + k * logA), label: `logC=${k}·A` });
      }
    }
  }
  return out.filter((l) => l.price > 0).sort((a, b) => a.price - b.price);
}

export function clusterLevels(cands: LevelCandidate[], tolPct = 3.5): FibCluster[] {
  const clusters: FibCluster[] = [];
  let group: LevelCandidate[] = [];

  const flush = (): void => {
    if (group.length === 0) return;
    const prices = group.map((g) => g.price);
    clusters.push({
      floor: Math.min(...prices),
      ceiling: Math.max(...prices),
      center: prices.reduce((s, x) => s + x, 0) / prices.length,
      score: group.length,
      labels: group.map((g) => g.label),
    });
    group = [];
  };

  for (const cand of cands) {
    if (group.length === 0 || (cand.price - group[0].price) / group[0].price <= tolPct / 100) {
      group.push(cand);
    } else {
      flush();
      group = [cand];
    }
  }
  flush();
  return clusters.sort((a, b) => b.score - a.score || a.center - b.center);
}
