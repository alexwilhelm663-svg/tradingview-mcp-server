import { fetchMarketData } from "./marketData";
import { findImpulseAdaptive, WaveCount } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { longLevelCandidates, clusterLevels, FibCluster } from "./fibCluster";
import { assessMultiWave } from "./multiWave";
import { readDegree } from "./degree";
import { getWatchlist } from "./watchlist";
import { zigzag } from "./zigzag";

/**
 * V157: Taeglicher Unterstuetzungs-Screener.
 *
 * Beantwortet eine einzige Frage pro Titel: Wie weit ist der Kurs von der
 * naechsten belastbaren Unterstuetzung entfernt?
 *
 * Bewusst OHNE LLM-Kritik und OHNE Chart-Rendering - der stuendliche
 * Radar-Scan verschickt pro Titel ein Bild und verbraucht Gemini-Quota. Der
 * Screener laeuft rein deterministisch ueber 30+ Titel und schickt EINE
 * Nachricht.
 *
 * Unterstuetzungs-Quellen, jeweils unterhalb des aktuellen Kurses:
 *  - Fib-Cluster der laufenden Korrektur (Score >= 2, also mind. zwei
 *    konfluente Herleitungen)
 *  - letztes hoeheres Tief einer intakten 1-2-Struktur
 *  - Median-Retracement aus der EIGENEN Korrektur-Historie des Titels (v6.6)
 *  - letztes markantes Swing-Tief (immer verfuegbar, auch ohne Zaehlung)
 * Die hoechste dieser Marken unter dem Kurs ist die naechste Unterstuetzung.
 *
 * Die Swing-Quelle ist entscheidend fuer die Abdeckung: Fib-Cluster entstehen
 * nur nach einem bullishen Impuls, und bei Enthaltung gaebe es sonst gar
 * nichts. Ohne sie blieben 17 von 30 Titeln ohne Marke.
 */

/**
 * Hoechstes BESTAETIGTES Swing-Tief unterhalb des Kurses.
 *
 * Zwei Filter sind noetig, sonst liefert der ZigZag das gerade erst
 * entstandene Tief der laufenden Bewegung: In einem ersten Entwurf lagen
 * sechs Titel gleichfoermig bei +1,1 bis +1,4 % - das war jeweils das
 * juengste, noch unbestaetigte Tief und damit kein Einstiegslevel.
 *  - MIN_AGE: das Tief muss ueberstanden sein (Kurs hat sich entfernt)
 *  - MIN_DIST: darunter ist es Rauschen, kein Level
 */
const SWING_MIN_AGE = 5;   // Kerzen
const SWING_MIN_DIST = 2;  // %

function swingSupport(
  candles: { date: string; low: number; close: number }[],
  price: number
): { level: number; source: string } | null {
  const lastIdx = candles.length - 1;
  let best: { level: number; source: string } | null = null;
  for (const th of [10, 7, 5]) {
    const lows = zigzag(candles as never, th).filter((p) => p.kind === "L");
    for (const l of lows) {
      if (l.price > price * (1 - SWING_MIN_DIST / 100)) continue;
      const i = candles.findIndex((k) => k.date === l.date);
      if (i < 0 || lastIdx - i < SWING_MIN_AGE) continue;
      if (!best || l.price > best.level) {
        best = { level: l.price, source: `Swing-Tief ${th} %` };
      }
    }
    if (best) break; // groebste Stufe gewinnt - markanter
  }
  return best;
}

export type SupportStatus = "AN_ZONE" | "NAH" | "FERN" | "UNTER" | "KEINE";

export interface ScreenerRow {
  symbol: string;
  price: number;
  status: SupportStatus;
  support: number | null;
  distPct: number | null;   // negativ = Kurs unter der Marke
  source: string;           // woher die Marke stammt
  trend: string | null;
  note: string | null;      // Zusatz (z. B. Zeitreife der Korrektur)
  deeper: { level: number; source: string } | null; // naechste Zone darunter
}

const AN_ZONE = 1.5;  // +/- % um die Marke
const NAH = 6;        // % darueber

function supportLevels(
  candles: { date: string; open: number; high: number; low: number; close: number }[],
  wc: WaveCount,
  threshold: number,
  price: number
): { level: number; source: string }[] {
  const cands: { level: number; source: string }[] = [];
  const pt = (l: string) => wc.points.find((p) => p.label === l) ?? null;
  const w0 = pt("0"), w4 = pt("4"), w5 = pt("5");

  // (a) Fib-Cluster der Korrektur nach bullishem Impuls
  if (wc.trend === "bullish" && w0 && w5) {
    const lv = longLevelCandidates({ w0: w0.price, w5: w5.price, w4: w4 ? w4.price : null });
    const clusters: FibCluster[] = clusterLevels(lv).filter(
      (c) => c.score >= 2 && c.ceiling < price
    );
    if (clusters.length > 0) {
      const top = clusters.reduce((m, c) => (c.ceiling > m.ceiling ? c : m));
      cands.push({ level: top.ceiling, source: `Fib-Cluster ${top.floor.toFixed(2)}–${top.ceiling.toFixed(2)}` });
    }
  }

  // (b) letztes hoeheres Tief einer intakten 1-2-Struktur
  if (w5) {
    const dirCounter: 1 | -1 = wc.trend === "bullish" ? -1 : 1;
    const mw = assessMultiWave(candles, w5.date, w5.price, dirCounter, threshold);
    if (mw.intact && mw.currentInvalidation != null && mw.currentInvalidation < price) {
      cands.push({ level: mw.currentInvalidation, source: `1-2-Marke (${mw.legs}×)` });
    }
  }

  // (c) Median-Retracement aus der eigenen Historie
  const deg = readDegree(candles, price);
  if (deg && deg.stats && w0 && w5 && wc.trend === "bullish" && w5.price > w0.price) {
    const legLog = Math.log(w5.price) - Math.log(w0.price);
    const med = Math.exp(Math.log(w5.price) - deg.stats.retrMed * legLog);
    if (med < price) cands.push({ level: med, source: `Median-Retr ${(deg.stats.retrMed * 100).toFixed(0)} %` });
  }

  const sw = swingSupport(candles, price);
  if (sw) cands.push(sw);

  // absteigend: naechste Unterstuetzung zuerst
  return cands.sort((a, b) => b.level - a.level);
}

export async function screenSymbol(symbol: string): Promise<ScreenerRow> {
  const empty: ScreenerRow = {
    symbol, price: NaN, status: "KEINE", support: null,
    distPct: null, source: "-", trend: null, note: null, deeper: null,
  };
  const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol, "1d", "2y");
  if (!candles || candles.length < 60) return { ...empty, note: "zu wenig Daten" };
  const price = candles[candles.length - 1].close;

  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);

  // Ohne Zaehlung bleibt die Swing-Unterstuetzung - besser als Schweigen.
  if (!outcome.impulse) {
    const sw = swingSupport(candles, price);
    if (!sw) return { ...empty, price, note: "keine Zählung, keine Marke" };
    const d = (price / sw.level - 1) * 100;
    const st: SupportStatus =
      Math.abs(d) <= AN_ZONE ? "AN_ZONE" : d < 0 ? "UNTER" : d <= NAH ? "NAH" : "FERN";
    return {
      symbol, price, status: st, support: sw.level, distPct: d,
      source: sw.source, trend: null, note: "ohne Zählung", deeper: null,
    };
  }
  const wc = outcome.impulse.result.count;
  const levels = supportLevels(candles, wc, outcome.impulse.threshold, price);
  if (levels.length === 0) {
    return { ...empty, price, trend: wc.trend, note: "keine Marke unter Kurs" };
  }
  const sup = levels[0];
  // Zweite Ebene: naechste Zone aus ANDERER Quelle, mind. 3 % tiefer.
  // Ohne diese Unterscheidung dominiert das Swing-Tief alles - Fib-Cluster
  // und Median-Retracement liegen tiefer und kaemen nie zur Anzeige.
  const deeper =
    levels.find(
      (l) => l.source !== sup.source && l.level < sup.level * 0.97
    ) ?? null;

  const distPct = (price / sup.level - 1) * 100;
  let status: SupportStatus;
  if (Math.abs(distPct) <= AN_ZONE) status = "AN_ZONE";
  else if (distPct < 0) status = "UNTER";
  else if (distPct <= NAH) status = "NAH";
  else status = "FERN";

  // Zeitreife der laufenden Korrektur als Zusatz
  let note: string | null = null;
  const deg = readDegree(candles, price);
  const w5 = wc.points.find((p) => p.label === "5");
  if (deg && deg.stats && w5) {
    const i5 = candles.findIndex((k) => k.date === w5.date);
    if (i5 >= 0) {
      const bars = candles.length - 1 - i5;
      if (bars > deg.stats.barsMax) note = `Korrektur überfällig (${bars} K)`;
      else if (bars >= deg.stats.barsMed) note = `Korrektur reif (${bars} K)`;
    }
  }

  return {
    symbol, price, status, support: sup.level, distPct,
    source: sup.source, trend: wc.trend, note, deeper,
  };
}

/**
 * V158: Kompakte Monospace-Tabelle.
 *
 * Der frühere Blocktext war auf dem Handy kaum zu scannen: pro Titel drei
 * Zeilen, umbrechende Fliesstexte, Emojis mitten in der Zeile. Jetzt eine
 * Tabelle im Codeblock - dort haelt Telegram die Spalten, weil Monospace
 * gerendert und horizontal gescrollt statt umgebrochen wird.
 *
 * WICHTIG: Keine Emojis INNERHALB der Tabelle. Sie sind je nach Font
 * unterschiedlich breit und zerreissen die Ausrichtung. Status steckt in der
 * Sortierung (naechste Unterstuetzung zuerst), Quelle und Reife in je einem
 * Zeichen.
 */

/** Kompakte Zahl: 1.72M · 63.0k · 823 · 47.08 · 0.0700 */
function num(n: number): string {
  if (!isFinite(n)) return "-";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(1) + "k";
  if (a >= 100) return n.toFixed(0);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/** Quelle auf ein Zeichen: F=Fib · M=1-2-Marke · R=Median-Retr · S=Swing */
function srcCode(source: string): string {
  if (source.startsWith("Fib")) return "F";
  if (source.startsWith("1-2")) return "M";
  if (source.startsWith("Median")) return "R";
  if (source.startsWith("Swing")) return "S";
  return "-";
}

/** Reife auf ein Zeichen: ! = überfällig · ~ = reif · Leerzeichen = früh */
function ripeCode(note: string | null): string {
  if (!note) return " ";
  if (note.includes("überfällig")) return "!";
  if (note.includes("reif")) return "~";
  return " ";
}

const RANK: Record<SupportStatus, number> = {
  AN_ZONE: 0, NAH: 1, UNTER: 2, FERN: 3, KEINE: 4,
};

export function formatDigest(rows: ScreenerRow[]): string {
  const shown = rows.filter((r) => r.status === "AN_ZONE" || r.status === "NAH" || r.status === "UNTER");
  shown.sort((a, b) => {
    const d = RANK[a.status] - RANK[b.status];
    return d !== 0 ? d : Math.abs(a.distPct ?? 999) - Math.abs(b.distPct ?? 999);
  });

  const head = `🛰️ **Unterstützung** · ${new Date().toISOString().slice(0, 10)} · ${shown.length}/${rows.length} nah`;
  if (shown.length === 0) {
    return head + "\n\nKein Titel in Reichweite einer Unterstützung.";
  }

  const cells = shown.map((r) => ({
    sym: r.symbol.length > 9 ? r.symbol.slice(0, 9) : r.symbol,
    kurs: num(r.price),
    zone: r.support != null ? num(r.support) : "-",
    abst: r.distPct != null ? `${r.distPct >= 0 ? "+" : ""}${r.distPct.toFixed(1)}` : "-",
    q: srcCode(r.source) + ripeCode(r.note),
    tief: r.deeper ? num(r.deeper.level) : "",
  }));
  const hasTief = cells.some((c) => c.tief !== "");
  const w = (k: "sym" | "kurs" | "zone" | "abst" | "tief") =>
    Math.max(k.length, ...cells.map((c) => c[k].length));
  const wS = w("sym"), wK = w("kurs"), wZ = w("zone"), wA = w("abst");
  const wT = hasTief ? Math.max(5, ...cells.map((c) => c.tief.length)) : 0;

  // Zweite Zone als SPALTE statt als Fliesstextzeile - die war 106 Zeichen
  // lang und brach auf dem Handy um, was die Tabellenwirkung zerstoerte.
  const row = (sym: string, kurs: string, zone: string, abst: string, q: string, tief: string) =>
    sym.padEnd(wS) + "  " + kurs.padStart(wK) + "  " + zone.padStart(wZ) + "  " +
    abst.padStart(wA) + "  " + q.padEnd(2) + (hasTief ? "  " + tief.padStart(wT) : "");

  const lines = [
    row("SYM", "KURS", "ZONE", "ABST", "Q", "↓ZONE"),
    ...cells.map((c) => row(c.sym, c.kurs, c.zone, c.abst, c.q, c.tief)),
  ];

  const parts = [head, "```\n" + lines.join("\n") + "\n```"];

  const rest = rows.filter((r) => r.status === "FERN" || r.status === "KEINE");
  if (rest.length) parts.push(`⚪ Entfernt (${rest.length}): ${rest.map((r) => r.symbol).join(" ")}`);

  parts.push("_F_ Fib · _M_ 1-2-Marke · _R_ Retr · _S_ Swing | _!_ überfällig · _~_ reif");
  return parts.join("\n\n");
}

export async function runScreener(symbols?: string[]): Promise<ScreenerRow[]> {
  const list = symbols && symbols.length ? symbols : getWatchlist();
  const rows: ScreenerRow[] = [];
  for (const s of list) {
    try {
      rows.push(await screenSymbol(s));
    } catch {
      rows.push({
        symbol: s, price: NaN, status: "KEINE", support: null,
        distPct: null, source: "-", trend: null, note: "Abruf fehlgeschlagen",
        deeper: null,
      });
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return rows;
}
