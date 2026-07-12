import type { Candle } from "./marketData";

export interface Pivot {
  index: number;
  date: string;
  price: number;
  kind: "H" | "L";
}

/**
 * Klassischer ZigZag: liefert alternierende Swing-Hochs/-Tiefs.
 * reversalPct = minimale Gegenbewegung in Prozent, um einen Pivot zu bestaetigen.
 * 25% auf Wochenbasis erfasst bei High-Beta-Titeln alle Makro-Beine.
 */
export function zigzag(candles: Candle[], reversalPct = 25): Pivot[] {
  if (candles.length < 3) return [];
  const th = reversalPct / 100;
  const pivots: Pivot[] = [];

  let dir: 1 | -1 = candles[1].close >= candles[0].close ? 1 : -1;
  let extIdx = 0;
  let extPrice = dir === 1 ? candles[0].high : candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    if (dir === 1) {
      if (c.high >= extPrice) {
        extPrice = c.high;
        extIdx = i;
      } else if ((extPrice - c.low) / extPrice >= th) {
        pivots.push({ index: extIdx, date: candles[extIdx].date, price: extPrice, kind: "H" });
        dir = -1;
        extPrice = c.low;
        extIdx = i;
      }
    } else {
      if (c.low <= extPrice) {
        extPrice = c.low;
        extIdx = i;
      } else if ((c.high - extPrice) / extPrice >= th) {
        pivots.push({ index: extIdx, date: candles[extIdx].date, price: extPrice, kind: "L" });
        dir = 1;
        extPrice = c.high;
        extIdx = i;
      }
    }
  }
  // letztes (noch unbestaetigtes) Extrem mit aufnehmen
  pivots.push({
    index: extIdx,
    date: candles[extIdx].date,
    price: extPrice,
    kind: dir === 1 ? "H" : "L",
  });
  return pivots;
}
