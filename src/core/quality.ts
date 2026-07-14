import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";
import { findBestImpulse, WaveCount } from "./impulseFinder";

export interface QualityAssessment {
  bonus: number;
  maxBonus: number;
  flags: string[];
  summary: string;
}

/**
 * Deterministische Qualitaets-Checks (V114, Stufe 1):
 * Die typischen "LLM-Zweifel" - Erschoepfung der Dynamik und unklare
 * interne Unterteilung - sind pruefbare Aussagen. Hier werden sie
 * gemessen statt gemutmasst:
 *
 *  1. W5-Divergenz (Elliott-Oszillator SMA5-SMA34): Ein 5. Welle-Extrem
 *     mit schwaecherem Oszillator als am W3-Extrem ist LEHRBUCH und
 *     bestaetigt die Zaehlung (+1). Fehlt die Divergenz, koennte das
 *     vermeintliche W5 eine W3 hoeheren Grades sein -> Flag.
 *  2. Subwellen-Struktur: Der Impuls-Finder laeuft rekursiv auf dem
 *     W3- und W5-Segment (feinere ZigZag-Stufen). Findet er dort einen
 *     regelkonformen 5-Teiler, ist die interne Unterteilung impulsiv
 *     belegt (+1 je Segment). Zu kurze Segmente werden uebersprungen
 *     (neutral, zaehlen nicht in maxBonus).
 */
export function assessQuality(
  candles: Candle[],
  wc: WaveCount,
  parentThreshold: number
): QualityAssessment {
  const dir: 1 | -1 = wc.trend === "bullish" ? 1 : -1;
  const flags: string[] = [];
  const parts: string[] = [];
  let bonus = 0;
  let maxBonus = 0;

  const point = (label: string) => wc.points.find((p) => p.label === label);
  const w2 = point("2");
  const w3 = point("3");
  const w4 = point("4");
  const w5 = point("5");

  // ── 1. Elliott-Oszillator-Divergenz (W5 vs. W3) ──
  const osc = oscillator(candles);
  const i3 = w3 ? candles.findIndex((c) => c.date === w3.date) : -1;
  const i5 = w5 ? candles.findIndex((c) => c.date === w5.date) : -1;
  if (i3 >= 34 && i5 >= 34 && osc[i3] != null && osc[i5] != null) {
    maxBonus += 1;
    const divergent = dir * ((osc[i5] as number) - (osc[i3] as number)) < 0;
    if (divergent) {
      bonus += 1;
      parts.push("W5-Divergenz ✓");
    } else {
      flags.push("KEINE_W5_DIVERGENZ");
      parts.push("W5-Divergenz –");
    }
  }

  // ── 2. Subwellen-Struktur von W3 und W5 ──
  const subCheck = (from: string | undefined, to: string | undefined, label: string): void => {
    if (!from || !to) return;
    const seg = candles.filter((c) => c.date >= from && c.date <= to);
    if (seg.length < 15) return; // zu kurz fuer belastbare Sub-Analyse (neutral)
    maxBonus += 1;
    for (const th of subThresholds(parentThreshold)) {
      const piv = zigzag(seg, th);
      if (piv.length < 6) continue;
      const sub = findBestImpulse(piv);
      if (sub && sub.count.trend === wc.trend) {
        bonus += 1;
        parts.push(`${label}-Sub ✓ (${th}%)`);
        return;
      }
    }
    flags.push(`${label}_SUB_UNKLAR`);
    parts.push(`${label}-Sub –`);
  };
  subCheck(w2?.date, w3?.date, "W3");
  subCheck(w4?.date, w5?.date, "W5");

  return {
    bonus,
    maxBonus,
    flags,
    summary: parts.length > 0 ? `Qualität ${bonus}/${maxBonus} (${parts.join(", ")})` : "Qualität n/a",
  };
}

/** Elliott-Oszillator: SMA5 - SMA34 auf Schlusskursen (null vor Index 33). */
function oscillator(candles: Candle[]): (number | null)[] {
  const closes = candles.map((c) => c.close);
  const sma = (i: number, n: number): number | null => {
    if (i < n - 1) return null;
    let s = 0;
    for (let k = i - n + 1; k <= i; k++) s += closes[k];
    return s / n;
  };
  return closes.map((_, i) => {
    const a = sma(i, 5);
    const b = sma(i, 34);
    return a != null && b != null ? a - b : null;
  });
}

/** Feinere ZigZag-Stufen fuer die Sub-Analyse, relativ zur Eltern-Stufe. */
function subThresholds(parent: number): number[] {
  const ladder = [
    Math.round(parent * 0.6),
    Math.round(parent * 0.4),
    Math.round(parent * 0.25),
  ].map((t) => Math.max(3, t));
  return [...new Set(ladder)];
}
