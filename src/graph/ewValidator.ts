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
2. "points" streng chronologisch aufsteigend nach Datum, beginnend mit Welle 0.
3. Impulse (bullish): Hochs (H) fuer 1/3/5, Tiefs (L) fuer 0/2/4.
4. Pruefe VOR der Antwort: W2 > W0? W3 > Ende W1? W4 > Ende W1 (kein Overlap)? Daten aufsteigend?`;

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
  // Verhindert falsch verankerte A/B-Beine und unmoegliche C-Projektionen.
  for (const point of wc.points) {
    const err = nearestPivotError(point, state.pivots);
    if (err) errors.push(err);
  }

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
