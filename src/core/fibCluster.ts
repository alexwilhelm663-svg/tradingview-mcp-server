export interface LevelCandidate {
  price: number;
  label: string;
  /** Statistisch unabhaengige Herleitungsfamilie, nicht bloss ein weiteres Ratio. */
  family?: "IMPULSE_RETRACEMENT" | "PRIOR_WAVE" | "ABC_PROJECTION" | "CORRECTION_PATTERN";
}

export interface FibCluster {
  floor: number;
  ceiling: number;
  center: number;
  /** Anzahl unabhaengiger Familien. */
  score: number;
  /** Anzahl einzelner Level; rein deskriptiv, kein Gate. */
  evidenceCount: number;
  labels: string[];
  families: string[];
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
      out.push({ price: p.w5 - f * imp, label: `Retr ${f}`, family: "IMPULSE_RETRACEMENT" });
      out.push({ price: Math.exp(Math.log(p.w5) - f * logRange), label: `logRetr ${f}`, family: "IMPULSE_RETRACEMENT" });
    }
  }
  if (p.w4 != null && p.w4 > 0) out.push({ price: p.w4, label: "W4-Zone", family: "PRIOR_WAVE" });
  if (p.aLow != null && p.aLow > 0 && p.bHigh != null) {
    const A = p.w5 - p.aLow;
    const logA = Math.log(p.w5) - Math.log(p.aLow);
    if (A > 0) {
      for (const k of [0.618, 1.0, 1.236, 1.618]) {
        const lin = p.bHigh - k * A;
        if (lin > 0) out.push({ price: lin, label: `C=${k}·A`, family: "ABC_PROJECTION" });
        out.push({ price: Math.exp(Math.log(p.bHigh) - k * logA), label: `logC=${k}·A`, family: "ABC_PROJECTION" });
      }
    }
  }
  return out.filter((l) => l.price > 0).sort((a, b) => a.price - b.price);
}

/**
 * Gruppiert Level, die naeher als tolPct beieinanderliegen, zu Clustern.
 * Score = Anzahl unabhaengiger Herleitungsfamilien. Mehrere Ratios oder
 * linear/log derselben Familie erhoehen nur evidenceCount, nie den Gate-Score.
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
      out.push({ price: p.w5 + f * imp, label: `Retr ${f}`, family: "IMPULSE_RETRACEMENT" });
      out.push({ price: Math.exp(Math.log(p.w5) + f * logRange), label: `logRetr ${f}`, family: "IMPULSE_RETRACEMENT" });
    }
  }
  if (p.w4 != null && p.w4 > 0) out.push({ price: p.w4, label: "W4-Zone", family: "PRIOR_WAVE" });
  if (p.aHigh != null && p.bLow != null && p.bLow > 0) {
    const A = p.aHigh - p.w5;
    const logA = Math.log(p.aHigh) - Math.log(p.w5);
    if (A > 0) {
      for (const k of [0.618, 1.0, 1.236, 1.618]) {
        out.push({ price: p.bLow + k * A, label: `C=${k}·A`, family: "ABC_PROJECTION" });
        out.push({ price: Math.exp(Math.log(p.bLow) + k * logA), label: `logC=${k}·A`, family: "ABC_PROJECTION" });
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
    const familyOf = (x: LevelCandidate): string => {
      if (x.family) return x.family;
      if (x.label === "W4-Zone") return "PRIOR_WAVE";
      if (x.label.startsWith("KO-Ziel")) return "CORRECTION_PATTERN";
      if (x.label.includes("C=") || x.label.includes("·A")) return "ABC_PROJECTION";
      return "IMPULSE_RETRACEMENT";
    };
    const families = [...new Set(group.map(familyOf))];
    clusters.push({
      floor: Math.min(...prices),
      ceiling: Math.max(...prices),
      center: prices.reduce((s, x) => s + x, 0) / prices.length,
      score: families.length,
      evidenceCount: group.length,
      labels: group.map((g) => g.label),
      families,
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
  return clusters.sort(
    (a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.center - b.center
  );
}
