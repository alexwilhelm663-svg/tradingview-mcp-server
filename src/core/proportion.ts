import type { Candle } from "./marketData";
import type { WaveCount } from "./impulseFinder";

export interface ProportionCheck { ok: boolean; reason: string | null }

/**
 * V146: Proportionalitaets-Veto.
 *
 * Eine winzige Welle 1 macht die harten Regeln TRIVIAL erfuellbar: HR-2
 * (Welle 3 nicht die kuerzeste) ist automatisch erfuellt, und der Score
 * belohnt grosse W3-Extension. Der Optimierer wird also dafuer belohnt, eine
 * degenerierte erste Welle zu waehlen - und presst dann ganze Seitwaerts-
 * phasen in Welle 3 (ARM: W1 +20 % / 4 Wochen, W3 +371 % / 135 Wochen mit
 * einem internen Rueckgang von 58 %).
 *
 * Drei Vetos, alle rein restriktiv - sie koennen nur verwerfen, nie zaehlen:
 *  (P1) Kein Gegenzug INNERHALB einer Antriebswelle darf groesser sein als
 *       der benachbarte Korrektur-Ruecklauf. Eine Welle 3, die intern mehr
 *       korrigiert als Welle 2, ist keine Welle 3.
 *  (P2) Zeitproportion: laengste zu kuerzester Antriebswelle <= 8x.
 *  (P3) Welle 1 muss mindestens 8 % der Impuls-Loglaenge tragen.
 */
const MAX_TIME_RATIO = 8;
const MIN_W1_SHARE = 0.08;

function pt(wc: WaveCount, label: string) {
  return wc.points.find((p) => p.label === label) ?? null;
}

function idxOf(candles: Candle[], date: string): number {
  return candles.findIndex((k) => k.date === date);
}

/** Groesster Gegenzug innerhalb eines Segments, in Log-Einheiten. */
function maxCounterMove(candles: Candle[], i0: number, i1: number, dir: 1 | -1): number {
  if (i0 < 0 || i1 < 0 || i1 <= i0) return 0;
  let ext = dir === 1 ? candles[i0].high : candles[i0].low;
  let worst = 0;
  for (let i = i0; i <= i1; i++) {
    const k = candles[i];
    if (dir === 1) {
      if (k.high > ext) ext = k.high;
      const back = Math.log(ext) - Math.log(k.low);
      if (back > worst) worst = back;
    } else {
      if (k.low < ext) ext = k.low;
      const back = Math.log(k.high) - Math.log(ext);
      if (back > worst) worst = back;
    }
  }
  return worst;
}

export function checkProportion(candles: Candle[], wc: WaveCount): ProportionCheck {
  const p0 = pt(wc, "0"), p1 = pt(wc, "1"), p2 = pt(wc, "2"),
        p3 = pt(wc, "3"), p4 = pt(wc, "4"), p5 = pt(wc, "5");
  if (!p0 || !p1 || !p2 || !p3 || !p4 || !p5) return { ok: true, reason: null };
  const dir: 1 | -1 = wc.trend === "bullish" ? 1 : -1;
  const L = (a: number, b: number) => Math.abs(Math.log(b) - Math.log(a));

  const w1 = L(p0.price, p1.price);
  const w2 = L(p1.price, p2.price);
  const w3 = L(p2.price, p3.price);
  const w4 = L(p3.price, p4.price);
  const w5 = L(p4.price, p5.price);
  const total = L(p0.price, p5.price);

  // (P3) degenerierte Welle 1
  if (total > 0 && w1 / total < MIN_W1_SHARE) {
    return {
      ok: false,
      reason: `Welle 1 traegt nur ${((w1 / total) * 100).toFixed(1)} % der Impulslaenge (< ${MIN_W1_SHARE * 100} %) - degenerierte erste Welle`,
    };
  }

  // (P2) Zeitproportion der Antriebswellen
  const i0 = idxOf(candles, p0.date), i1 = idxOf(candles, p1.date),
        i2 = idxOf(candles, p2.date), i3 = idxOf(candles, p3.date),
        i4 = idxOf(candles, p4.date), i5 = idxOf(candles, p5.date);
  const durs = [i1 - i0, i3 - i2, i5 - i4].filter((d) => d > 0);
  if (durs.length === 3) {
    const ratio = Math.max(...durs) / Math.min(...durs);
    if (ratio > MAX_TIME_RATIO) {
      return {
        ok: false,
        reason: `Antriebswellen zeitlich unverhaeltnismaessig (${durs.join("/")} Kerzen, Faktor ${ratio.toFixed(0)}x > ${MAX_TIME_RATIO}x)`,
      };
    }
  }

  // (P1) interner Gegenzug vs. benachbarte Korrektur
  const inner3 = maxCounterMove(candles, i2, i3, dir);
  if (inner3 > Math.max(w2, w4) * 1.15 && inner3 > 0.15) {
    return {
      ok: false,
      reason: `Ruecksetzer innerhalb Welle 3 (${((Math.exp(inner3) - 1) * 100).toFixed(0)} %) uebersteigt die Korrekturen W2/W4 - Welle 3 nicht zusammenhaengend`,
    };
  }
  const inner5 = maxCounterMove(candles, i4, i5, dir);
  if (inner5 > Math.max(w2, w4) * 1.15 && inner5 > 0.15) {
    return {
      ok: false,
      reason: `Ruecksetzer innerhalb Welle 5 (${((Math.exp(inner5) - 1) * 100).toFixed(0)} %) uebersteigt die Korrekturen W2/W4`,
    };
  }
  return { ok: true, reason: null };
}
