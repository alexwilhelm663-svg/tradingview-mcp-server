// @ts-nocheck
import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "radar_state.db");
const memory = new SqliteSaver({ dbPath });

// NEUES, STRIKTES SCHEMA
const WaveCountSchema = z.object({
  asset: z.string(),
  timeframe: z.string(),
  current_price: z.number(),
  hauptzaehlung: z.string().describe("Detaillierte Beschreibung der Hauptzählung"),
  alternativzaehlung: z.string(),
  wahrscheinlichkeit: z.number().describe("0-100"),
  konfidenz: z.string(),
  invalidation_level: z.number(),
  target_1: z.number(),
  target_2: z.number(),
  target_3: z.number(),
  risk_reward: z.number(),
  historische_vergleiche: z.string(),
  telegram_signal: z.enum(["YES", "NO"]),
  begruendung: z.string().describe("Faktenbasiert, keine Emotionen, keine erfundenen Wellen"),
});

export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  waveCount: Annotation<z.infer<typeof WaveCountSchema> | null>(),
  isValid: Annotation<boolean>(),
  errorLogs: Annotation<string[]>({
    reducer: (current: string[], next: string[]) => current.concat(next),
    default: () => [],
  }),
});

async function analyzeNode(state: typeof RadarState.State) {
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0,
  }).withStructuredOutput(WaveCountSchema);

  const systemPrompt = `
    Du bist ElliottScreener, ein institutioneller Elliott-Wellen-Research-Agent.
    DEINE AUFGABE: Prüfe Marktdaten auf valide Elliott-Strukturen.
    STRIKTE FILTER:
    - Probability muss >= 70 sein.
    - RiskReward muss >= 3 sein.
    - Wenn keine belegbare Struktur: telegram_signal = 'NO'.
    - Invalidation-Level MUSS zwingend definiert sein.
  `;

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Analysiere ${state.symbol}. Daten: ${JSON.stringify(state.marketData)}` }
  ]);

  return { waveCount: response };
}

async function validateNode(state: typeof RadarState.State) {
  const count = state.waveCount;
  if (!count) return { isValid: false, errorLogs: ["Keine Zählung."] };
  
  // Hier könnte noch eine mathematische Validierung der Targets vs Current Price erfolgen
  console.log(`[Validation] Signal für ${state.symbol}: ${count.telegram_signal}`);
  return { isValid: true };
}

const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate")
  .addEdge("validate", END);

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
