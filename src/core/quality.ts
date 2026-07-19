import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";
import { WaveCount, segmentVerdict, SubVerdict, extensionType } from "./impulseFinder";

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
  const extType = extensionType(wc.points, dir);
  const w2 = point("2");
  const w3 = point("3");
  const w4 = point("4");
  const w5 = point("5");

  // ── 1. Elliott-Oszillator-Divergenz (W5 vs. W3) ──
  const osc = oscillator(candles);
  const i3 = w3 ? candles.findIndex((c) => c.date === w3.date) : -1;
  const i5 = w5 ? candles.findIndex((c) => c.date === w5.date) : -1;
  if (i3 >= 34 && i5 >= 34 && osc[i3] != null && osc[i5] != null) {
    if (extType === 5) {
      // GL-6 typbewusst (V120, Koenz): Bei Ext-W5 traegt die 5 die Kraft -
      // fehlende Divergenz ist ERWARTBAR, kein Flag, keine Wertung.
      parts.push("W5-Divergenz n/a (Ext-W5)");
    } else {
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
  }

  // ── 2. Subwellen-Struktur von W3 und W5 ──
  const subCheck = (from: string | undefined, to: string | undefined, label: string): void => {
    if (!from || !to) return;
    const seg = candles.filter((c) => c.date >= from && c.date <= to);
    if (seg.length < 15) return; // zu kurz fuer belastbare Sub-Analyse (neutral)
    maxBonus += 1;
    const verdict: SubVerdict = segmentVerdict(candles, from, to, dir, parentThreshold);
    if (verdict === "IMPULSIVE") {
      bonus += 1;
      parts.push(`${label}-Sub ✓`);
      return;
    }
    if (verdict === "DIAGONAL") {
      if (label === "W5") {
        // DG-1: Ending Diagonal an Position 5 ist kanonisch (V116)
        bonus += 1;
        parts.push("W5 = Ending Diagonal (DG-1) ✓");
        flags.push("W5_ENDING_DIAGONAL");
      } else {
        // HR-5/DK-8: Welle 3 ist NIEMALS eine Diagonale
        flags.push("W3_DIAGONAL_STRUKTUR");
        parts.push("W3-Sub – (Diagonal, HR-5!)");
      }
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
    // GL-5 typbewusst (V120, Koenz): Volumen-Maximum liegt in der
    // GESTRECKTEN Welle - Ext-W5-Impulse haben steigendes Profil.
    const volOk =
      extType === 1 ? v1 >= v3 && v1 >= v5
      : extType === 5 ? v5 >= v3 && v3 >= v1
      : v3 >= v1 && v3 >= v5;
    const lbl = extType === 1 ? "W1-Dominanz" : extType === 5 ? "steigend, Ext-W5" : "W3-Dominanz";
    if (volOk) {
      bonus += 1;
      parts.push(`Volumen ✓ (${lbl})`);
    } else {
      flags.push("VOLUMEN_PROFIL_ATYPISCH");
      parts.push("Volumen –");
    }
  }

  // ── 4b. GL-2b (V120, Koenz): Retrace-Baender je Extensionstyp - INFO ──
  const w0q = point("0"), w1q = point("1");
  if (extType != null && w0q && w1q && w2 && w3 && w4) {
    const lq = (pr: number): number => dir * Math.log(pr);
    const L1q = lq(w1q.price) - lq(w0q.price);
    const L3q = lq(w3.price) - lq(w2.price);
    if (L1q > 0 && L3q > 0) {
      const r2 = (lq(w1q.price) - lq(w2.price)) / L1q;
      const r4 = (lq(w3.price) - lq(w4.price)) / L3q;
      maxBonus += 1;
      const ok =
        extType === 1
          ? r2 >= 0.236 && r2 <= 0.618 && r4 >= 0.236 && r4 <= 0.5
          : r2 >= 0.382 && r2 <= 0.9 && r4 >= 0.236 && r4 <= 0.618;
      if (ok) { bonus += 1; parts.push(`Retrace-Typ ✓ (Ext-W${extType})`); }
      else parts.push(`Retrace-Typ ~ (Ext-W${extType})`);
    }
  }

  // ── 5. Fib-Zeit (GL-7 NEU, V120/Koenz): Zeit-Baender je Wellenpaar ──
  if (i0 >= 0 && i1 > i0 && i2 > i1 && i3 > i2 && i4 > i3 && i5 > i4) {
    const t1 = i1 - i0, t2 = i2 - i1, t4 = i4 - i3, t5 = i5 - i4;
    if (t1 > 0) {
      maxBonus += 1;
      const r2 = t2 / t1;
      if (r2 >= 0.382 && r2 < 2.0) { bonus += 1; parts.push("Zeit-W2 ✓"); }
      else if (r2 >= 4.0) { flags.push("ZEIT_W2_ATYPISCH"); parts.push("Zeit-W2 –"); }
      else parts.push("Zeit-W2 ~");
    }
    if (t2 > 0) {
      maxBonus += 1;
      const r4 = t4 / t2;
      // Zeit-Alternation: W4 ist meist LAENGER als W2 (Koenz)
      if (r4 >= 1.0 && r4 < 5.0) { bonus += 1; parts.push("Zeit-Alt ✓"); }
      else if (r4 >= 5.0) { flags.push("ZEIT_W4_ATYPISCH"); parts.push("Zeit-Alt –"); }
      else parts.push("Zeit-Alt ~");
    }
    if (extType === 3 && t1 > 0) {
      // W5 ~ W1 in der Zeit nur bei gestreckter Dritter vergleichbar
      maxBonus += 1;
      const r5 = t5 / t1;
      if (r5 >= 0.618 && r5 <= 1.618) { bonus += 1; parts.push("Zeit-W5 ✓"); }
      else parts.push("Zeit-W5 ~");
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


