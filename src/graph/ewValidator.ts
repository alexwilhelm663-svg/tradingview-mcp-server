import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";
import type { Pivot } from "../core/zigzag";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const memory = SqliteSaver.fromConnString(path.join(DATA_DIR, "radar_state.db"));

function getOKFContext(): string {
  const rulesPath = path.join(process.cwd(), "knowledge/rules/elliott_rules.md");
  return fs.existsSync(rulesPath)
    ? fs.readFileSync(rulesPath, "utf-8")
    : "Keine Regeln gefunden.";
}

export const WavePointSchema = z.object({
  label: z
    .string()
    .describe('Wellen-Label: "0","1","2","3","4","5" oder "A","B","C","W","X","Y"'),
  date: z
    .string()
    .describe("Datum des Wellenpunkts (YYYY-MM-DD), muss exakt einem Kerzendatum entsprechen"),
  price: z.number().describe("Preis am Wellenpunkt"),
});
export type WavePoint = z.infer<typeof WavePointSchema>;

const WaveCountSchema = z.object({
  trend: z.enum(["bullish", "bearish"]),
  points: z
    .array(WavePointSchema)
    .min(3)
    .describe("Chronologisch sortierte Wellenpunkte, beginnend mit Welle 0"),
  analysis: z.string(),
});
export type WaveCount = z.infer<typeof WaveCountSchema>;

export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  pivots: Annotation<Pivot[]>({ reducer: (_c, n) => n, default: () => [] }),
  systemContext: Annotation<string>(),
  waveCount: Annotation<WaveCount | null>(),
  isValid: Annotation<boolean>(),
  errorLogs: Annotation<string[]>({ reducer: (_c, n) => n, default: () => [] }),
  attempts: Annotation<number>({ reducer: (c, n) => c + n, default: () => 0 }),
});

function pt(wc: WaveCount, label: string): WavePoint | undefined {
  return wc.points.find((p) => p.label === label);
}

// Toleranzen fuer die Pivot-Konformitaet der LLM-Punkte
/** Wartet bei Rate-Limits (429) die von der API genannte Zeit ab und versucht es erneut. */
async function invokeWithBackoff<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      const rateLimited = msg.includes("429") || msg.includes("Too Many Requests");
      if (i < maxRetries && rateLimited) {
        const m = msg.match(/retry in ([0-9.]+)s/i);
        const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 1000 : 30_000;
        console.warn(`[LLM] Rate-Limit – warte ${Math.round(waitMs / 1000)}s (Retry ${i + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw err;
    }
  }
}

const PIVOT_PRICE_TOL = 0.06; // 6% Preisabweichung
const PIVOT_DAYS_TOL = 45; // 45 Tage Datumsabweichung

/**
 * Struktur-Vertrag (V112.3), gilt IMMER - schliesst die Reward-Hacking-Luecke,
 * dass rein korrektive Zaehlungen (W-X-Y / A-B-C ohne Impuls) alle Pruefungen
 * passieren: die vollstaendige Impulszaehlung 0-5 ist Pflicht, Korrektur-Labels
 * sind nur als Anhang NACH Welle 5 erlaubt. Zusaetzlich muss das trend-Feld
 * zur Impulsrichtung (W5 vs. W0) passen.
 */
export function structuralErrors(wc: WaveCount): string[] {
  const errs: string[] = [];
  const required = ["0", "1", "2", "3", "4", "5"];
  const missing = required.filter((l) => !wc.points.some((x) => x.label === l));
  if (missing.length > 0) {
    errs.push(
      `Unvollstaendig: Die Antwort MUSS die komplette Impulszaehlung ${required.join(",")} enthalten - es fehlen: ${missing.join(",")}. Korrektur-Labels (A/B/C bzw. W/X/Y) sind nur ZUSAETZLICH nach Welle 5 erlaubt, niemals als Ersatz.`
    );
    return errs;
  }
  const w0 = wc.points.find((x) => x.label === "0");
  const w5 = wc.points.find((x) => x.label === "5");
  if (w0 && w5) {
    const impliedBullish = w5.price > w0.price;
    if ((wc.trend === "bullish") !== impliedBullish) {
      errs.push(
        `Trend-Widerspruch: trend="${wc.trend}", aber der Impuls laeuft von ${w0.price} nach ${w5.price}. Setze trend passend zur Impulsrichtung.`
      );
    }
    const idx5 = wc.points.findIndex((x) => x.label === "5");
    const badTail = wc.points
      .slice(0, idx5)
      .filter((x) => ["A", "B", "C", "W", "X", "Y"].includes(x.label));
    if (badTail.length > 0) {
      errs.push(
        `Struktur-Verstoss: Korrektur-Labels (${badTail.map((x) => x.label).join(",")}) stehen vor Welle 5. Die Korrektur folgt NACH dem Impuls.`
      );
    }
  }
  return errs;
}

/**
 * Saekulare Doktrin (V112.2), nur in der strikten Phase (Versuch 1-2):
 *  - Welle 0 am globalen Extrem der Pivot-Liste verankern
 *  - keine Trunkierung (W5 muss das W3-Extrem ueberschreiten)
 * In Versuch 3 entfaellt beides (Best-Effort statt Totalausfall).
 */
export function doctrineErrors(wc: WaveCount, pivots: Pivot[], strict: boolean): string[] {
  const errs: string[] = [];
  if (!strict || pivots.length === 0) return errs;
  const dir = wc.trend === "bullish" ? 1 : -1;
  const w0 = wc.points.find((x) => x.label === "0");
  const w3 = wc.points.find((x) => x.label === "3");
  const w5 = wc.points.find((x) => x.label === "5");

  const pool = pivots.filter((x) => x.kind === (dir === 1 ? "L" : "H"));
  if (w0 && pool.length > 0) {
    const anchor = pool.reduce((m, x) =>
      dir === 1 ? (x.price < m.price ? x : m) : (x.price > m.price ? x : m)
    );
    if (Math.abs(w0.price - anchor.price) / anchor.price > PIVOT_PRICE_TOL) {
      errs.push(
        `Doktrin-Verstoss: Welle 0 (${w0.date}, ${w0.price}) ist nicht das ${dir === 1 ? "tiefste L" : "hoechste H"}-Pivot. Verankere Welle 0 am Pivot ${anchor.kind} ${anchor.date} @ ${anchor.price.toFixed(2)} (saekulare Trend-Doktrin).`
      );
    }
  }
  if (w3 && w5 && dir * (w5.price - w3.price) < 0) {
    errs.push(
      `Trunkierung: Welle 5 (${w5.price}) endet ${dir === 1 ? "unter" : "ueber"} dem Welle-3-Extrem (${w3.price}). Waehle den Zaehlrahmen so, dass Welle 5 das Welle-3-Extrem ueberschreitet (ggf. endet der Impuls frueher).`
    );
  }
  return errs;
}

function nearestPivotError(point: WavePoint, pivots: Pivot[]): string | null {
  if (pivots.length === 0) return null;
  const pDate = new Date(point.date).getTime();
  const ok = pivots.some((piv) => {
    const priceDiff = Math.abs(piv.price - point.price) / piv.price;
    const daysDiff = Math.abs(new Date(piv.date).getTime() - pDate) / 86_400_000;
    return priceDiff <= PIVOT_PRICE_TOL && daysDiff <= PIVOT_DAYS_TOL;
  });
  return ok
    ? null
    : `Punkt "${point.label}" (${point.date}, ${point.price}) liegt an keinem markanten ZigZag-Pivot – verankere ihn an einem der vorgegebenen Pivots.`;
}

async function analyzeNode(state: typeof RadarState.State) {
  const llm = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
  }).withStructuredOutput(WaveCountSchema);

  const pivotList = state.pivots
    .map((p) => `${p.kind} ${p.date} @ ${p.price.toFixed(2)}`)
    .join("\n");

  // Kompakter Kurskontext statt 260 Rohkerzen: Pivots tragen die Struktur,
  // die letzten 12 Wochen liefern den aktuellen Stand. (~90% weniger Input-Tokens)
  const candles: any[] = Array.isArray(state.marketData) ? state.marketData : [];
  const recent = candles
    .slice(-12)
    .map((c: any) => `${c.date} H ${Number(c.high).toFixed(2)} L ${Number(c.low).toFixed(2)} C ${Number(c.close).toFixed(2)}`)
    .join("\n");
  const lastClose = candles.length > 0 ? Number(candles[candles.length - 1].close).toFixed(2) : "n/a";

  const systemPrompt = `Du bist ein erfahrener Elliott-Wave-Analyst.
REGELWERK (OKF-BASIS):
${getOKFContext()}

PERFORMANCE-KONTEXT: ${state.systemContext}

ZIGZAG-PIVOTS (die EINZIGEN erlaubten Wellenpunkte):
${pivotList || "keine"}

AUSGABEVERTRAG (hart):
1. Jeder Punkt in "points" MUSS exakt ein (date, price)-Paar aus der Pivot-Liste sein. Keine anderen Punkte.
2. "points" enthaelt IMMER die VOLLSTAENDIGE Impulszaehlung 0,1,2,3,4,5 des Makro-Zyklus - eine Antwort ohne alle sechs Impuls-Labels wird abgelehnt. Die laufende Korrektur (A,B,C bzw. W,X,Y) darf NUR ZUSAETZLICH nach Welle 5 folgen. Streng chronologisch aufsteigend.
3. Impulse (bullish): Hochs (H) fuer 1/3/5, Tiefs (L) fuer 0/2/4.
4. Pruefe VOR der Antwort: W2 > W0? W3 > Ende W1? W4 > Ende W1 (kein Overlap)? Daten aufsteigend?
5. SAEKULARE DOKTRIN: Welle 0 = tiefstes L-Pivot der GESAMTEN Liste (bullish) bzw. hoechstes H-Pivot (bearish).
6. KEINE TRUNKIERUNG: Welle 5 muss das Welle-3-Extrem ueberschreiten. Endet der Markt darunter, war das W3-Extrem die Welle 5 eines frueher endenden Impulses - zaehle entsprechend.
7. "trend" beschreibt die Richtung des Impulses 0->5 (bullish wenn W5 > W0, sonst bearish) - NICHT die Richtung der laufenden Korrektur.`;

  const rejected =
    state.errorLogs.length > 0 && state.waveCount
      ? `\n\nDeine letzte Zaehlung wurde ABGELEHNT:\n${JSON.stringify(state.waveCount.points)}\nVerstoesse:\n- ${state.errorLogs.join("\n- ")}\nKorrigiere GENAU diese Punkte und pruefe den Ausgabevertrag erneut.`
      : "";

  const response = await invokeWithBackoff(() =>
    llm.invoke([
      ["system", systemPrompt],
      [
        "human",
        `Analysiere ${state.symbol}. Aktueller Kurs: ${lastClose}. Letzte 12 Wochenkerzen:\n${recent}${rejected}`,
      ],
    ])
  );

  return { waveCount: response as WaveCount, attempts: 1 };
}

async function validateNode(state: typeof RadarState.State) {
  const wc = state.waveCount;
  const errors: string[] = [];

  if (!wc || wc.points.length < 3) {
    return { isValid: false, errorLogs: ["Keine oder zu wenige Wellenpunkte geliefert."] };
  }

  // NEU (V112.3): Struktur-Vertrag - Impulszaehlung 0-5 ist Pflicht (immer)
  const structErrs = structuralErrors(wc);
  if (structErrs.length > 0) {
    return { isValid: false, errorLogs: structErrs };
  }

  // Gesetz 1: keine Zeitspruenge
  for (let i = 1; i < wc.points.length; i++) {
    if (wc.points[i].date < wc.points[i - 1].date) {
      errors.push(
        `Zeitsprung: ${wc.points[i].label} (${wc.points[i].date}) liegt vor ${wc.points[i - 1].label} (${wc.points[i - 1].date}).`
      );
      break;
    }
  }

  // Impuls-Geometrie (richtungsneutral)
  const dir = wc.trend === "bullish" ? 1 : -1;
  const w0 = pt(wc, "0");
  const w1 = pt(wc, "1");
  const w2 = pt(wc, "2");
  const w3 = pt(wc, "3");
  const w4 = pt(wc, "4");

  if (w0 && w1 && w2 && dir * (w2.price - w0.price) <= 0)
    errors.push("Regel-Verstoss: Welle 2 retraced Welle 1 zu mehr als 100%.");
  if (w1 && w3 && dir * (w3.price - w1.price) <= 0)
    errors.push("Regel-Verstoss: Welle 3 ueberschreitet das Ende von Welle 1 nicht.");
  if (w1 && w4 && dir * (w4.price - w1.price) <= 0)
    errors.push("Regel-Verstoss: Welle 4 ueberlappt das Preisgebiet von Welle 1.");

  // NEU (V112): Pivot-Konformitaet – jeder Punkt muss an einem echten Swing liegen.
  for (const point of wc.points) {
    const err = nearestPivotError(point, state.pivots);
    if (err) errors.push(err);
  }

  // NEU (V112.2): Saekulare Doktrin (strikt in Versuch 1-2, Best-Effort in Versuch 3)
  errors.push(...doctrineErrors(wc, state.pivots, state.attempts < 3));

  return errors.length > 0 ? { isValid: false, errorLogs: errors } : { isValid: true, errorLogs: [] };
}

const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate");

builder.addConditionalEdges("validate", (s: typeof RadarState.State) =>
  s.isValid || s.attempts >= 3 ? END : "analyze"
);

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
