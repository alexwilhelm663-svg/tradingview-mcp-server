import { fetchMarketData, Candle, isThinHistory } from "./marketData";
import { findImpulseAdaptive } from "./impulseFinder";
import { checkProportion } from "./proportion";
import { classifyCorrection } from "./correction";
import { readDegree } from "./degree";
import { zigzag } from "./zigzag";
import { spawn } from "child_process";
import path from "path";

/**
 * V167: Korrektur-Detail.
 *
 * Die Tafel zeigt die Korrektur als Linienzug W-X-Y. Dieses zweite Bild zoomt
 * hinein und zaehlt die BINNENSTRUKTUR jedes Beins: bei einem Double Zigzag
 * steckt in W ein a-b-c und in Y ein weiteres. Dazu eine Vollstaendigkeits-
 * Pruefung - kann die Korrektur noch weiterlaufen oder ist sie ausgereizt?
 *
 * Die Pruefung ist bewusst mehrteilig, weil kein Einzelkriterium traegt:
 * Preisziel, Sub-Struktur, Retracement des Impulses und Zeit werden getrennt
 * beurteilt und einzeln ausgewiesen.
 */

export interface CorrectionDetail {
  buffer: Buffer | null;
  caption: string;
}

interface Leg {
  label: string;
  fromDate: string; fromPrice: number;
  toDate: string;   toPrice: number;
  subs: { label: string; date: string; price: number }[];
  subCount: number;
}

/**
 * Sub-Zaehlung innerhalb eines Korrekturbeins.
 *
 * Die Schwelle wird ADAPTIV gewaehlt: eine feste Ableitung vom Elterngrad
 * (parentTh / 3) lieferte bei BTC "W 10-teilig, Y 18-teilig" - das ist keine
 * a-b-c-Zaehlung, sondern Rauschen. Gesucht ist die groebste Stufe, die 3
 * Beine ergibt (a-b-c); erst wenn keine passt, wird feiner gegangen.
 */
function countSubs(candles: Candle[], from: string, to: string, parentTh: number) {
  const seg = candles.filter((k) => k.date >= from && k.date <= to);
  if (seg.length < 6) return { subs: [], n: 0, th: 0 };
  const marks = ["a", "b", "c", "d", "e"];
  const cands = [parentTh * 0.8, parentTh * 0.6, parentTh * 0.45, parentTh * 0.33, parentTh * 0.25]
    .map((x) => Math.max(2, Math.min(20, x)));

  let best: { piv: ReturnType<typeof zigzag>; th: number; score: number } | null = null;
  for (const th of cands) {
    const piv = zigzag(seg, th);
    const beine = piv.length + 1;
    // 3 Beine ideal (a-b-c), 5 akzeptabel (Fuenfer im C), alles darueber Rauschen
    const score = beine === 3 ? 0 : beine === 5 ? 1 : Math.abs(beine - 3) + 2;
    if (!best || score < best.score) best = { piv, th, score };
    if (score === 0) break;
  }
  if (!best) return { subs: [], n: 0, th: 0 };
  const subs = best.piv.slice(0, 5).map((q, i) => ({ label: marks[i], date: q.date, price: q.price }));
  return { subs, n: best.piv.length + 1, th: best.th };
}

export async function buildCorrectionChart(
  symbol: string,
  range = "5y",
  interval = "1wk"
): Promise<CorrectionDetail> {
  let candles: Candle[];
  try {
    candles = (await fetchMarketData(symbol, interval, range)).weeklyAnalysisCandles;
  } catch (e: any) {
    if (isThinHistory(e)) return { buffer: null, caption: `⚠️ ${symbol}: zu wenig Historie.` };
    return { buffer: null, caption: `❌ ${symbol}: ${e?.message ?? e}` };
  }

  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
  if (!outcome.impulse) return { buffer: null, caption: `🔍 ${symbol}: keine Zählung.` };
  const wc = outcome.impulse.result.count;
  const up = wc.trend === "bullish";
  const w5 = wc.points.find((p) => p.label === "5");
  const w0 = wc.points.find((p) => p.label === "0");
  if (!w5 || !w0) return { buffer: null, caption: `🔍 ${symbol}: unvollständige Zählung.` };

  const th = outcome.impulse.threshold;
  const price = candles[candles.length - 1].close;
  const postPiv = zigzag(candles, th).filter((q) => q.date > w5.date);
  const wantA: "L" | "H" = up ? "L" : "H";
  const a = postPiv.find((q) => q.kind === wantA) ?? null;
  const b = a ? postPiv.find((q) => q.date > a.date && q.kind !== wantA) ?? null : null;
  if (!a || !b) return { buffer: null, caption: `🔍 ${symbol}: Korrektur noch ohne A-B-Struktur.` };

  const after = candles.filter((k) => k.date > b.date);
  const cExt = after.length
    ? up ? Math.min(...after.map((k) => k.low)) : Math.max(...after.map((k) => k.high))
    : null;
  const cDate = after.length
    ? after.reduce((m, k) => ((up ? k.low < m.low : k.high > m.high) ? k : m), after[0]).date
    : null;

  const cr = classifyCorrection(
    w5.price, a.price, b.price, cExt, price, postPiv, up ? 1 : -1,
    { candles, parentThreshold: th, topDate: w5.date, aDate: a.date, bDate: b.date,
      impulseOrigin: w0.price, impulseEnd: w5.price }
  );
  const isDouble = /DOUBLE|KOMBI/.test(cr.pattern);
  const L = isDouble ? ["W", "X", "Y"] : ["A", "B", "C"];

  const legs: Leg[] = [];
  const mkLeg = (label: string, fd: string, fp: number, td: string, tp: number) => {
    const s = countSubs(candles, fd, td, th);
    legs.push({ label, fromDate: fd, fromPrice: fp, toDate: td, toPrice: tp, subs: s.subs, subCount: s.n });
  };
  mkLeg(L[0], w5.date, w5.price, a.date, a.price);
  mkLeg(L[1], a.date, a.price, b.date, b.price);
  if (cExt != null && cDate) mkLeg(L[2], b.date, b.price, cDate, cExt);

  // ── Vollstaendigkeit: vier getrennte Kriterien ────────────────────────
  const wLog = Math.abs(Math.log(a.price) - Math.log(w5.price));
  const yLog = cExt != null ? Math.abs(Math.log(cExt) - Math.log(b.price)) : 0;
  const ratio = wLog > 0 ? yLog / wLog : 0;
  const impLog = Math.abs(Math.log(w5.price) - Math.log(w0.price));
  const retr = cExt != null ? Math.abs(Math.log(w5.price) - Math.log(cExt)) / impLog : 0;
  const deg = readDegree(candles, price);
  const i5 = candles.findIndex((k) => k.date === w5.date);
  const bars = i5 >= 0 ? candles.length - 1 - i5 : 0;

  const checks: { label: string; wert: string; status: "OK" | "OFFEN" | "REIF" }[] = [];
  checks.push({
    label: `${L[2]} / ${L[0]}`,
    wert: `${ratio.toFixed(2)}×`,
    status: ratio >= 0.95 ? "REIF" : ratio >= 0.6 ? "OK" : "OFFEN",
  });
  const lastLeg = legs[legs.length - 1];
  checks.push({
    label: `${L[2]}-Struktur`,
    wert: `${lastLeg.subCount}-teilig`,
    status: lastLeg.subCount >= 3 ? "REIF" : "OFFEN",
  });
  checks.push({
    label: "Retracement",
    wert: `${(retr * 100).toFixed(0)} %`,
    status: deg?.stats
      ? retr >= deg.stats.retrMed ? "REIF" : retr >= deg.stats.retrMin ? "OK" : "OFFEN"
      : retr >= 0.5 ? "REIF" : "OK",
  });
  checks.push({
    label: "Dauer",
    wert: `${bars} K`,
    status: deg?.stats
      ? bars >= deg.stats.barsMax ? "REIF" : bars >= deg.stats.barsMed ? "OK" : "OFFEN"
      : "OK",
  });

  const reif = checks.filter((c) => c.status === "REIF").length;
  // Bruchmarke: ueber X (bzw. B) ist die Korrektur strukturell beendet
  const breakLevel = b.price;
  const broken = up ? price > breakLevel : price < breakLevel;
  const fazit = broken
    ? `beendet – ${L[1]} bei ${breakLevel.toFixed(2)} überschritten`
    : reif >= 3
      ? "ausgereizt – Umkehr wahrscheinlicher als Fortsetzung"
      : reif >= 2
        ? "fortgeschritten – Ziele teilweise erreicht"
        : "kann weiterlaufen";

  const payload = {
    symbol, interval: interval === "1d" ? "DAILY" : "WEEKLY",
    pattern: cr.pattern, labels: L,
    candles: candles.filter((k) => k.date >= w5.date),
    anchor: { date: w5.date, price: w5.price },
    legs, checks, fazit, broken, breakLevel, price,
    ziel: cr.targetPrice, zielLabel: cr.targetLabel,
    stand: new Date().toISOString().slice(0, 10),
  };

  const buffer = await new Promise<Buffer | null>((resolve) => {
    const script = path.join(process.cwd(), "python_service", "correction_drawer.py");
    const py = spawn("python3", [script]);
    const chunks: Buffer[] = [];
    py.stdout.on("data", (d) => chunks.push(d));
    py.stderr.on("data", (d) => console.error("[CORR]", d.toString().slice(0, 300)));
    py.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });

  return {
    buffer,
    caption: `🔬 Korrektur ${cr.pattern} · ${fazit}`,
  };
}
