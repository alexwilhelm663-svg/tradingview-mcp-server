import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";
import { findBestImpulse, WaveCount } from "./impulseFinder";
import { detectDiagonal } from "./diagonal";

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
    // DG-1-Aufloesung (V116): keine Impuls-Substruktur -> Keil pruefen.
    // Ein Ending Diagonal ERKLAERT die 3-3-3-3-3-Struktur kanonisch.
    const diag = detectDiagonal(seg, dir);
    if (diag) {
      bonus += 1;
      parts.push(`${label} = Ending Diagonal (DG-1${diag.throwOver ? ", Throw-over" : ""}) ✓`);
      flags.push(`${label}_ENDING_DIAGONAL`);
      return;
    }
    flags.push(`${label}_SUB_UNKLAR`);
    parts.push(`${label}-Sub –`);
  };
  subCheck(w2?.date, w3?.date, "W3");
  subCheck(w4?.date, w5?.date, "W5");

  const idx = (d?: string): number => (d ? candles.findIndex((c) => c.date === d) : -1);
  const w0 = point("0");
  const w1 = point("1");
  const i0 = idx(w0?.date);
  const i1 = idx(w1?.date);
  const i2 = idx(w2?.date);
  const i4 = idx(w4?.date);

  // ── 3. Kanal-Check (GL-4): W4 respektiert die 0-2-Basislinie (Log-Raum) ──
  if (w0 && w2 && w3 && w4 && i0 >= 0 && i2 > i0 && i3 > i2 && i4 > i3) {
    const l = (pr: number): number => dir * Math.log(pr);
    const m = (l(w2.price) - l(w0.price)) / (i2 - i0);
    const base = (i: number): number => l(w0.price) + m * (i - i0);
    const width = l(w3.price) - base(i3);
    if (width > 0) {
      maxBonus += 1;
      const d4 = (l(w4.price) - base(i4)) / width;
      if (d4 >= -0.1 && d4 <= 0.35) {
        bonus += 1;
        parts.push("Kanal ✓");
      } else if (d4 < -0.15) {
        flags.push("KANAL_VERLETZT");
        parts.push("Kanal –");
      } else {
        parts.push("Kanal ~"); // deutlich ueber der Basislinie: neutral-schwach, kein Flag
      }
    }
  }

  // ── 4. Volumen (GL-5): W3-Dominanz und W5-Erschoepfung ──
  const legVol = (from: number, to: number): number | null => {
    if (from < 0 || to <= from) return null;
    const seg = candles.slice(from + 1, to + 1).map((c) => c.volume ?? 0);
    if (seg.length === 0 || seg.every((v) => v === 0)) return null;
    return seg.reduce((s, v) => s + v, 0) / seg.length;
  };
  const v1 = legVol(i0, i1);
  const v3 = legVol(i2, i3);
  const v5 = legVol(i4, i5);
  if (v1 != null && v3 != null && v5 != null) {
    maxBonus += 1;
    if (v3 >= v1 && v3 >= v5) {
      bonus += 1;
      parts.push("Volumen ✓ (W3-Dominanz)");
    } else {
      flags.push("VOLUMEN_W3_SCHWACH");
      parts.push("Volumen –");
    }
  }

  // ── 5. Fib-Zeit (GL-7): Dauer-Relationen der Antriebswellen ──
  if (i0 >= 0 && i1 > i0 && i2 > i1 && i3 > i2 && i4 > i3 && i5 > i4) {
    maxBonus += 1;
    const d1 = i1 - i0;
    const d3 = i3 - i2;
    const d5 = i5 - i4;
    const fibs = [0.382, 0.618, 1.0, 1.618, 2.618];
    const near = (r: number): boolean => fibs.some((f) => Math.abs(r - f) / f <= 0.12);
    if (d1 > 0 && d3 > 0 && d5 > 0 && (near(d3 / d1) || near(d5 / d3) || near(d5 / d1))) {
      bonus += 1;
      parts.push("Fib-Zeit ✓");
    } else {
      parts.push("Fib-Zeit –"); // Soft-Guideline: kein Flag (GL-7)
    }
  }

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
