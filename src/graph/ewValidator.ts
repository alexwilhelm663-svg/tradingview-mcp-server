// @ts-nocheck
import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";

// 1. Persistenz-Layer für die OKF-Wissensbasis
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const dbPath = path.join(DATA_DIR, "radar_state.db");
const memory = new SqliteSaver({ dbPath });

// 2. Institutionelles Output-Schema (Strikte Typisierung)
export const WaveCountSchema = z.object({
  asset: z.string(),
  timeframe: z.string(),
  current_price: z.number(),
  hauptzaehlung: z.string().describe("Detaillierte Elliott-Wellen-Hauptzählung basierend auf Preisstruktur"),
  alternativzaehlung: z.string().describe("Alternative Elliott-Wellen-Zählung mit Wahrscheinlichkeitsbewertung"),
  wahrscheinlichkeit: z.number().describe("Score 0-100% basierend auf Strukturqualität, Fibs und Konsistenz"),
  konfidenz: z.string(),
  invalidation_level: z.number().describe("Preisniveau, bei dessen Bruch das Setup hinfällig ist"),
  target_1: z.number(),
  target_2: z.number(),
  target_3: z.number(),
  risk_reward: z.number(),
  historische_vergleiche: z.string(),
  telegram_signal: z.enum(["YES", "NO"]),
  begruendung: z.string().describe("Faktenbasierte Begründung unter Ausschluss von Emotionen"),
});

// 3. Status-Annotation für den Graph
export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  waveCount: Annotation<z.infer<typeof WaveCountSchema> | null>(),
  isValid: Annotation<boolean>(),
});

// 4. Analyse-Node mit institutionellem Prompt
async function analyzeNode(state: typeof RadarState.State) {
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0, // Keine Kreativität, strikte Datenanalyse
  }).withStructuredOutput(WaveCountSchema);

  const systemPrompt = `Du bist ElliottScreener V1, ein institutioneller Elliott-Wellen-Research-Agent.
  PRÜFE ZWINGEND:
  1. Welle 2 Retracement (0.382-0.786).
  2. Welle 3 Extension (1.618-4.236).
  3. Welle 4 darf Welle 1 nicht überlappen.
  4. Kanaltechnik & Fraktale Konsistenz auf mehreren Zeitebenen.
  
  FILTER: Signal nur YES, wenn Probability >= 70, RRR >= 3 und Invalidation definiert.
  Falls keine valide Elliott-Struktur: telegram_signal = 'NO'.`;

  const response = await llm.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: `Analysiere ${state.symbol} basierend auf diesen Daten: ${JSON.stringify(state.marketData)}` }
  ]);
  
  return { waveCount: response };
}

// 5. Graphen-Struktur
const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", END);

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
