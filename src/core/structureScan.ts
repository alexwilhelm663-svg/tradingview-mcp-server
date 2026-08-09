import { fetchMarketData, Candle } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { assessMultiWave } from "./multiWave";
import { getWatchlist } from "./watchlist";

/**
 * V168: 1-2-Suche ueber die Watchlist, auflösungsfrei.
 *
 * `/setup` zeigt EINEN Titel. Diese Suche laeuft ueber alle und meldet, wo
 * ueberhaupt eine 1-2-Staffelung steht. Auf Stundenbasis ist die Ausbeute
 * duenn - die V144-Anforderungen (zwei vollstaendige Einheiten, Welle-2-Tief
 * mindestens 5 Kerzen alt) sind intraday selten erfuellt. Genau deshalb ist
 * die Suche nuetzlich: sie zeigt die wenigen Treffer, statt dass man 30 Titel
 * einzeln abfragt.
 */

export interface ScanHit {
  symbol: string;
  legs: number;
  nested: boolean;
  intact: boolean;
  marke: number | null;
  price: number;
  distPct: number | null;
  note: string;
}

const RANGES: Record<string, string[]> = {
  "1h": ["730d", "60d"],
  "30m": ["60d", "1mo"],
  "1d": ["2y", "1y"],
  "1wk": ["5y", "max"],
};

async function scanOne(symbol: string, interval: string): Promise<ScanHit | null> {
  let candles: Candle[] | null = null;
  for (const rg of RANGES[interval] ?? ["2y"]) {
    try {
      const r = await fetchMarketData(symbol, interval, rg);
      if (r.weeklyAnalysisCandles && r.weeklyAnalysisCandles.length >= 60) {
        candles = r.weeklyAnalysisCandles;
        break;
      }
    } catch {
      /* naechstes Fenster */
    }
  }
  if (!candles) return null;

  const price = candles[candles.length - 1].close;
  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles!, r.count).ok);

  // Anker: Welle 5 der Zaehlung, sonst das Fenster-Extrem
  let anchorDate: string, anchorPrice: number, dir: 1 | -1, th = 8;
  if (outcome.impulse) {
    const w5 = outcome.impulse.result.count.points.find((p) => p.label === "5");
    if (!w5) return null;
    anchorDate = w5.date;
    anchorPrice = w5.price;
    dir = outcome.impulse.result.count.trend === "bullish" ? -1 : 1;
    th = outcome.impulse.threshold;
  } else {
    let lo = candles[0], hi = candles[0];
    for (const k of candles) {
      if (k.low < lo.low) lo = k;
      if (k.high > hi.high) hi = k;
    }
    const up = price > (lo.low + hi.high) / 2;
    anchorDate = up ? lo.date : hi.date;
    anchorPrice = up ? lo.low : hi.high;
    dir = up ? 1 : -1;
  }

  const mw = assessMultiWave(candles, anchorDate, anchorPrice, dir, th);
  if (!mw.note) return null;
  return {
    symbol,
    legs: mw.legs,
    nested: mw.active,
    intact: mw.intact,
    marke: mw.currentInvalidation,
    price,
    distPct: mw.currentInvalidation != null ? (price / mw.currentInvalidation - 1) * 100 : null,
    note: mw.note,
  };
}

export async function scanStructures(interval: string, symbols?: string[]): Promise<ScanHit[]> {
  const list = symbols && symbols.length ? symbols : getWatchlist();
  const hits: ScanHit[] = [];
  for (const s of list) {
    try {
      const h = await scanOne(s, interval);
      if (h) hits.push(h);
    } catch {
      /* Titel ueberspringen */
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return hits;
}

export function formatScan(hits: ScanHit[], interval: string, total: number): string {
  const head = `🔎 **1-2-Strukturen** · ${interval} · ${hits.length}/${total} Titel`;
  if (hits.length === 0) {
    return head + `\n\nKeine belastbare 1-2-Staffelung auf ${interval}.`;
  }
  const num = (n: number) =>
    Math.abs(n) >= 1e4 ? (n / 1e3).toFixed(1) + "k" : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2);

  const rows = [...hits].sort((a, b) => {
    if (a.intact !== b.intact) return a.intact ? -1 : 1;
    if (a.nested !== b.nested) return a.nested ? -1 : 1;
    return Math.abs(a.distPct ?? 999) - Math.abs(b.distPct ?? 999);
  });
  const cells = rows.map((r) => ({
    sym: r.symbol.slice(0, 9),
    e: String(r.legs),
    marke: r.marke != null ? num(r.marke) : "-",
    abst: r.distPct != null ? `${r.distPct >= 0 ? "+" : ""}${r.distPct.toFixed(1)}` : "-",
    flag: (r.nested ? "V" : "·") + (r.intact ? "" : "✕"),
  }));
  const w = (k: "sym" | "marke" | "abst") => Math.max(k.length, ...cells.map((c) => c[k].length));
  const wS = w("sym"), wM = Math.max(5, w("marke")), wA = Math.max(4, w("abst"));
  const line = (s: string, e: string, m: string, a: string, f: string) =>
    s.padEnd(wS) + "  " + e.padStart(2) + "  " + m.padStart(wM) + "  " + a.padStart(wA) + "  " + f;

  const tab = [line("SYM", "N", "MARKE", "ABST", "F"),
    ...cells.map((c) => line(c.sym, c.e, c.marke, c.abst, c.flag))];
  return `${head}\n\n\`\`\`\n${tab.join("\n")}\n\`\`\`\n\n_N_ Einheiten · _V_ verschachtelt · _✕_ gebrochen`;
}
