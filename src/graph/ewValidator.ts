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
  errorLogs: Annotation<string[]>({ reducer: (c, n) => c.concat(n), default: () => [] }),
  attempts: Annotation<number>({ reducer: (c, n) => c + n, default: () => 0 }),
});

function pt(wc: WaveCount, label: string): WavePoint | undefined {
  return wc.points.find((p) => p.label === label);
}

// Toleranzen fuer die Pivot-Konformitaet der LLM-Punkte
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
    model: process.env.GEMINI_MODEL ?? "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
  }).withStructuredOutput(WaveCountSchema);

  const pivotList = state.pivots
    .map((p) => `${p.kind} ${p.date} @ ${p.price.toFixed(2)}`)
    .join("\n");

  const systemPrompt = `Du bist ein erfahrener Elliott-Wave-Analyst.
REGELWERK (OKF-BASIS):
${getOKFContext()}

PERFORMANCE-KONTEXT: ${state.systemContext}

DETERMINISTISCHE ZIGZAG-PIVOTS (Anker-Pflicht):
${pivotList || "keine"}

Liefere eine chronologische Wellenzaehlung als Punkte-Array.
Jeder Punkt braucht label, date (exakt aus den Kursdaten) und price.
WICHTIG: Jeder Wellenpunkt MUSS an einem der obigen Pivots verankert sein
(gleiches Datum/Preisniveau). Erfinde keine Zwischenextreme.`;

  const feedback =
    state.errorLogs.length > 0
      ? `\n\nDeine letzte Zaehlung wurde abgelehnt. Korrigiere folgende Verstoesse:\n- ${state.errorLogs.join("\n- ")}`
      : "";

  const response = await llm.invoke([
    ["system", systemPrompt],
    ["human", `Analysiere ${state.symbol}. Kursdaten (Weekly): ${JSON.stringify(state.marketData)}${feedback}`],
  ]);

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

  return errors.length > 0 ? { isValid: false, errorLogs: errors } : { isValid: true };
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
