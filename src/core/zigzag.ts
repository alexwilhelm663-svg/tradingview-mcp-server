import type { Candle } from "./marketData";

export interface Pivot {
  index: number;
  date: string;
  price: number;
  kind: "H" | "L";
  status: "CONFIRMED" | "PROVISIONAL" | "SYNTHETIC";
  /** Bar, auf dem die Gegenbewegung den Pivot bestaetigt hat. */
  confirmedAt: string | null;
}

/**
 * Klassischer ZigZag: liefert alternierende Swing-Hochs/-Tiefs.
 * reversalPct = minimale Gegenbewegung in Prozent, um einen Pivot zu bestaetigen.
 * 25% auf Wochenbasis erfasst bei High-Beta-Titeln alle Makro-Beine.
 */
export function zigzag(
  candles: Candle[],
  reversalPct = 25,
  includeProvisional = false
): Pivot[] {
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
        pivots.push({
          index: extIdx,
          date: candles[extIdx].date,
          price: extPrice,
          kind: "H",
          status: "CONFIRMED",
          confirmedAt: c.date,
        });
        dir = -1;
        extPrice = c.low;
        extIdx = i;
      }
    } else {
      if (c.low <= extPrice) {
        extPrice = c.low;
        extIdx = i;
      } else if ((c.high - extPrice) / extPrice >= th) {
        pivots.push({
          index: extIdx,
          date: candles[extIdx].date,
          price: extPrice,
          kind: "L",
          status: "CONFIRMED",
          confirmedAt: c.date,
        });
        dir = 1;
        extPrice = c.high;
        extIdx = i;
      }
    }
  }
  // Das laufende Extrem ist Repaint-Risiko und bleibt fuer Signalpfade
  // standardmaessig draussen. Charts koennen es explizit anfordern.
  if (includeProvisional) {
    pivots.push({
      index: extIdx,
      date: candles[extIdx].date,
      price: extPrice,
      kind: dir === 1 ? "H" : "L",
      status: "PROVISIONAL",
      confirmedAt: null,
    });
  }
  return pivots;
}
