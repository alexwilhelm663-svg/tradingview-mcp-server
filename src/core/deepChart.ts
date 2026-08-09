import { fetchMarketData, Candle, isThinHistory } from "./marketData";
import { findImpulseAdaptive, WaveCount } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { longLevelCandidates, shortLevelCandidates, clusterLevels, FibCluster } from "./fibCluster";
import { assessMultiWave } from "./multiWave";
import { measureContinuity } from "./continuity";
import { readDegree } from "./degree";
import { zigzag } from "./zigzag";
import { classifyCorrection, CorrectionRead } from "./correction";
import { spawn } from "child_process";
import path from "path";

/**
 * V165: Analyse-Tafel (`/deep`).
 *
 * Der Standard-Chart bleibt schlank - er laeuft bei jeder Analyse. Diese Tafel
 * buendelt auf Abruf alles, was die Engine ohnehin berechnet, in EIN Bild:
 * Zaehlung mit beschrifteten Punkten, Zielzonen, Entscheidungsmarken,
 * Seitenleiste und einen schematischen Projektionspfad.
 *
 * Die Projektion zeichnet den Weg zu den BEREITS BERECHNETEN Zielzonen - sie
 * ist keine Kursprognose. Kein RSI (die Engine ist rein strukturell) und keine
 * frei gesetzte Wahrscheinlichkeit: statt einer Zahl wie "55/45" zeigt die
 * Tafel Zaehlungs-Score und Kontinuitaet, die beide aus den Daten stammen.
 */

export interface DeepResult {
  buffer: Buffer | null;
  caption: string;
}

interface Scenario {
  name: string;
  color: string;
  path: { price: number; label: string }[];
  note: string;
}

const pt = (wc: WaveCount, l: string) => wc.points.find((p) => p.label === l) ?? null;

interface TradePlan {
  art: string;
  entry: number;
  stop: number;
  ziel: number;
  risk: number;   // % vom Einstieg
  crv: number;
}

/**
 * Zwei handelbare Varianten aus den bereits berechneten Zonen:
 *  - Ruecksetzer: in der naechsten Zone GEGEN den Kurs kaufen, Stop darunter
 *  - Ausbruch: ueber der naechsten Zone MIT dem Trend, Stop unter deren Boden
 * Ziel ist jeweils die naechste Zone in Trendrichtung dahinter.
 */
function buildTrades(up: boolean, price: number, clusters: FibCluster[]): TradePlan[] {
  const out: TradePlan[] = [];
  const asc = [...clusters].sort((a, b) => a.center - b.center);
  const above = asc.filter((c) => c.floor > price);
  const below = asc.filter((c) => c.ceiling < price).reverse();

  const mk = (art: string, entry: number, stop: number, ziel: number) => {
    const risk = Math.abs(entry - stop) / entry * 100;
    const crv = Math.abs(ziel - entry) / Math.max(Math.abs(entry - stop), 1e-9);
    if (!isFinite(crv) || risk <= 0) return;
    out.push({ art, entry, stop, ziel, risk, crv });
  };

  if (up) {
    // Ruecksetzer in die naechste Zone darunter
    const z = below[0];
    const target = above[0] ?? clusters.sort((a, b) => b.center - a.center)[0];
    if (z && target) mk("Rücksetzer", z.ceiling, z.floor * 0.97, target.center);
    // Ausbruch ueber die naechste Zone darueber
    const b = above[0];
    const t2 = above[1];
    if (b && t2) mk("Ausbruch", b.ceiling, b.floor * 0.97, t2.center);
  } else {
    const z = above[0];
    const target = below[0] ?? clusters.sort((a, b) => a.center - b.center)[0];
    if (z && target) mk("Rücklauf", z.floor, z.ceiling * 1.03, target.center);
    const b = below[0];
    const t2 = below[1];
    if (b && t2) mk("Bruch", b.floor, b.ceiling * 1.03, t2.center);
  }
  return out;
}

/** Schematischer Pfad zu den bereits berechneten Zielzonen. */
function buildScenarios(
  wc: WaveCount,
  price: number,
  clusters: FibCluster[],
  trigger: number | null,
  invalidation: number | null
): Scenario[] {
  const above = clusters.filter((c) => c.center > price).sort((a, b) => a.center - b.center);
  const below = clusters.filter((c) => c.center < price).sort((a, b) => b.center - a.center);
  const up = wc.trend === "bullish";
  const out: Scenario[] = [];

  const primTargets = up ? above : below;
  if (primTargets.length > 0) {
    const t1 = primTargets[0].center;
    const t2 = primTargets[1]?.center ?? t1 * (up ? 1.12 : 0.9);
    const back = t1 + (price - t1) * 0.38; // schematischer Ruecksetzer
    out.push({
      name: "PRIMÄR",
      color: "#22c55e",
      path: [
        { price, label: "" },
        { price: trigger ?? (price + t1) / 2, label: "Trigger" },
        { price: t1, label: "Ziel 1" },
        { price: back, label: "" },
        { price: t2, label: "Ziel 2" },
      ],
      note: `${up ? "Aufwärts" : "Abwärts"} zu ${t1.toFixed(2)}, dann ${t2.toFixed(2)}`,
    });
  }

  // Gegenrichtung. Steht der Kurs in keiner Zone, gibt es keine berechnete
  // Invalidierung - dann dient die naechste Zone in Gegenrichtung als Auslöser.
  const altTargets = up ? below : above;
  if (altTargets.length > 0) {
    const gate = invalidation ?? altTargets[0].ceiling;
    const a1 = altTargets[0].center;
    const a2 = altTargets[1]?.center ?? a1 * (up ? 0.88 : 1.12);
    out.push({
      name: "ALTERNATIVE",
      color: "#f97316",
      path: [
        { price, label: "" },
        { price: gate, label: invalidation != null ? "Invalidierung" : "Bruch" },
        { price: a1, label: "Ziel A" },
        { price: a2, label: "Ziel B" },
      ],
      note: `Unter ${gate.toFixed(2)} → ${a1.toFixed(2)} / ${a2.toFixed(2)}`,
    });
  }
  return out;
}

function renderDeep(payload: unknown): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "python_service", "deep_drawer.py");
    const py = spawn("python3", [script]);
    const chunks: Buffer[] = [];
    py.stdout.on("data", (d) => chunks.push(d));
    py.stderr.on("data", (d) => console.error("[DEEP]", d.toString().slice(0, 300)));
    py.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

export async function buildDeepChart(
  symbol: string,
  range = "5y",
  interval = "1wk"
): Promise<DeepResult> {
  let candles: Candle[];
  try {
    candles = (await fetchMarketData(symbol, interval, range)).weeklyAnalysisCandles;
  } catch (e: any) {
    if (isThinHistory(e)) {
      return {
        buffer: null,
        caption: `⚠️ **${symbol}**: ${e.have} von ${e.need} Kerzen (Erstnotiz ${e.firstTrade ?? "?"}).`,
      };
    }
    return { buffer: null, caption: `❌ ${symbol}: ${e?.message ?? e}` };
  }

  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
  if (!outcome.impulse) {
    return { buffer: null, caption: `🔍 **${symbol}**: keine belastbare Zählung (DK-7).` };
  }
  const res = outcome.impulse.result;
  const wc = res.count;
  const price = candles[candles.length - 1].close;
  const up = wc.trend === "bullish";
  const w0 = pt(wc, "0"), w4 = pt(wc, "4"), w5 = pt(wc, "5");

  // Zielzonen. Ohne die Korrektur-Legs (A/B) entstehen nur Einzel-Level ohne
  // Konfluenz - alle mit Score 1. Erst die C-Ableitungen erzeugen Zonen.
  let clusters: FibCluster[] = [];
  if (w0 && w5) {
    const post = candles.filter((k) => k.date > w5.date);
    const piv = zigzag(post, outcome.impulse.threshold).filter((q) => q.date > w5.date);
    const wantA: "L" | "H" = up ? "L" : "H";
    const a = piv.find((q) => q.kind === wantA) ?? null;
    const b = a ? piv.find((q) => q.date > a.date && q.kind !== wantA) ?? null : null;
    const base = { w0: w0.price, w5: w5.price, w4: w4 ? w4.price : null };
    const lv = up
      ? longLevelCandidates({ ...base, aLow: a ? a.price : null, bHigh: b ? b.price : null })
      : shortLevelCandidates({ ...base, aHigh: a ? a.price : null, bLow: b ? b.price : null });
    const all = clusterLevels(lv);
    const strong = all.filter((c) => c.score >= 2);
    // Fallback auf die hoechstbewerteten Einzel-Level, damit die Tafel nie
    // ohne Zonen bleibt.
    clusters = strong.length >= 2 ? strong : all.sort((x, y) => y.score - x.score).slice(0, 6);
  }

  const marks: { price: number; label: string; color: string }[] = [];
  if (w5) marks.push({ price: w5.price, label: "Welle-5-Extrem", color: "#38bdf8" });
  if (w0) marks.push({ price: w0.price, label: "Impuls-Ursprung", color: "#a78bfa" });

  let trigger: number | null = null;
  let invalidation: number | null = null;
  const inZone = clusters.find((c) => price >= c.floor && price <= c.ceiling);
  if (inZone) {
    invalidation = up ? inZone.floor * 0.97 : inZone.ceiling * 1.03;
    const over = clusters
      .filter((c) => (up ? c.floor > price : c.ceiling < price))
      .sort((a2, b2) => (up ? a2.floor - b2.floor : b2.ceiling - a2.ceiling))[0];
    if (over) trigger = up ? over.floor : over.ceiling;
  }
  if (trigger != null) marks.push({ price: trigger, label: "Trigger", color: "#22c55e" });
  if (invalidation != null) marks.push({ price: invalidation, label: "Invalidierung", color: "#ef4444" });

  // V166: Korrektur-Lesart (A-B-C / W-X-Y) - fehlte in der Tafel komplett,
  // obwohl der Standard-Chart sie zeichnet.
  let corrPoints: { label: string; date: string; price: number }[] = [];
  let corrPattern: string | null = null;
  if (w5) {
    const postPiv = zigzag(candles, outcome.impulse.threshold).filter((q) => q.date > w5.date);
    const wantA: "L" | "H" = up ? "L" : "H";
    const a = postPiv.find((q) => q.kind === wantA) ?? null;
    const b = a ? postPiv.find((q) => q.date > a.date && q.kind !== wantA) ?? null : null;
    if (a && b) {
      const after = candles.filter((k) => k.date > b.date);
      const cExt = after.length
        ? up ? Math.min(...after.map((k) => k.low)) : Math.max(...after.map((k) => k.high))
        : null;
      const cDate = after.length
        ? after.reduce((m, k) => ((up ? k.low < m.low : k.high > m.high) ? k : m), after[0]).date
        : null;
      const cr: CorrectionRead = classifyCorrection(
        w5.price, a.price, b.price, cExt, price, postPiv, up ? 1 : -1,
        {
          candles, parentThreshold: outcome.impulse.threshold, topDate: w5.date,
          aDate: a.date, bDate: b.date,
          impulseOrigin: w0?.price ?? null, impulseEnd: w5.price,
        }
      );
      corrPoints = cr.legPoints;
      corrPattern = cr.pattern;
      if (cDate && corrPoints.length === 2 && cExt != null) {
        corrPoints.push({ label: /DOUBLE|WXY|KOMBI/.test(cr.pattern) ? "Y" : "C", date: cDate, price: cExt });
      }
    }
  }

  let mwPoints: { label: string; date: string; price: number }[] = [];
  if (w5) {
    const mw = assessMultiWave(candles, w5.date, w5.price, up ? -1 : 1, outcome.impulse.threshold);
    if (mw.intact && mw.points.length) mwPoints = mw.points;
  }

  const cont = measureContinuity(zigzag(candles, outcome.impulse.threshold), wc);
  const deg = readDegree(candles, price);

  const payload = {
    symbol,
    interval: interval === "1d" ? "DAILY" : "WEEKLY",
    range,
    price,
    trend: wc.trend,
    candles,
    waves: wc.points.map((p) => ({ label: p.label, date: p.date, price: p.price })),
    multiWave: mwPoints,
    correction: corrPoints,
    corrPattern,
    trades: buildTrades(up, price, clusters),
    clusters: clusters.map((c) => ({
      floor: c.floor, ceiling: c.ceiling, score: c.score, labels: c.labels,
    })),
    marks,
    scenarios: buildScenarios(wc, price, clusters, trigger, invalidation),
    struktur: {
      score: `${res.score}/${res.maxScore}`,
      anker: res.doctrineAnchor ? "Doktrin" : "Fallback",
      zigzag: `${outcome.impulse.threshold} %`,
      kontinuitaet: cont ? `${(cont.ratio * 100).toFixed(0)} % übersprungen` : "-",
      grad: deg ? deg.cycleGrade : "-",
      raster: deg?.stats
        ? `${(deg.stats.retrMin * 100).toFixed(0)}–${(deg.stats.retrMed * 100).toFixed(0)}–${(deg.stats.retrMax * 100).toFixed(0)} %`
        : "-",
    },
    stand: new Date().toISOString().slice(0, 10),
  };

  const buffer = await renderDeep(payload);
  const caption =
    `📐 **${symbol}** · ${payload.interval} (${range}) · ${wc.trend} · Score ${res.score}/${res.maxScore}` +
    (trigger != null ? `\nTrigger ${trigger.toFixed(2)}` : "") +
    (invalidation != null ? ` · Invalidierung ${invalidation.toFixed(2)}` : "");
  return { buffer, caption };
}
