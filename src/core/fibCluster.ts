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
  if (imp > 0) {
    for (const f of [0.5, 0.618, 0.786, 0.886]) {
      out.push({ price: p.w5 - f * imp, label: `Retr ${f}` });
    }
  }
  if (p.w4 != null && p.w4 > 0) out.push({ price: p.w4, label: "W4-Zone" });
  if (p.aLow != null && p.bHigh != null) {
    const A = p.w5 - p.aLow;
    if (A > 0) {
      for (const k of [0.618, 1.0, 1.236, 1.618]) {
        const price = p.bHigh - k * A;
        if (price > 0) out.push({ price, label: `C=${k}·A` });
      }
    }
  }
  return out.filter((l) => l.price > 0).sort((a, b) => a.price - b.price);
}

/**
 * Gruppiert Level, die naeher als tolPct beieinanderliegen, zu Clustern.
 * Score = Anzahl konfluenter Herleitungen. Sortierung: Score, dann Preis.
 */
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
