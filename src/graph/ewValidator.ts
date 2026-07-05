// @ts-nocheck
import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";

// Sicherstellen, dass das Data-Verzeichnis existiert
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const memory = new SqliteSaver({ dbPath: path.join(DATA_DIR, "radar_state.db") });

// Kontext-Loader
function getOKFContext() {
  const rulesPath = path.join(process.cwd(), 'knowledge/rules/elliott_rules.md');
  return fs.existsSync(rulesPath) ? fs.readFileSync(rulesPath, 'utf-8') : "Keine Regeln gefunden.";
}

const WaveCountSchema = z.object({
  trend: z.enum(["bullish", "bearish"]),
  points: z.object({ start: z.number(), wave1: z.number(), wave2: z.number(), wave3: z.number(), wave4: z.number(), wave5: z.number() }),
  analysis: z.string(),
});

export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  systemContext: Annotation<string>(), // NEU: Kontext aus engine.ts
  waveCount: Annotation<z.infer<typeof WaveCountSchema> | null>(),
  isValid: Annotation<boolean>(),
  errorLogs: Annotation<string[]>({ reducer: (c, n) => c.concat(n), default: () => [] }),
  attempts: Annotation<number>({ reducer: (c, n) => c + n, default: () => 0 }),
});

async function analyzeNode(state: typeof RadarState.State) {
  const llm = new ChatGoogleGenerativeAI({ 
    model: "gemini-1.5-pro", 
    apiKey: process.env.GEMINI_API_KEY, 
    temperature: 0 
  }).withStructuredOutput(WaveCountSchema);

  // System-Prompt vereint OKF-Regeln und den dynamischen Performance-Kontext
  const systemPrompt = `Du bist ein erfahrener Elliott-Wave-Trader.
  OKF-BASIS: ${getOKFContext()}
  PERFORMANCE-KONTEXT: ${state.systemContext}`;

  const response = await llm.invoke([
    { role: "system", content: systemPrompt }, 
    { role: "user", content: `Analysiere ${state.symbol}: ${JSON.stringify(state.marketData)}` }
  ]);
  
  return { waveCount: response, attempts: 1 };
}

async function validateNode(state: typeof RadarState.State) {
  const p = state.waveCount?.points;
  const errors: string[] = [];
  if (p && (p.wave2 <= p.start || p.wave4 <= p.wave1)) errors.push("Geometrie-Verstoß");
  return errors.length > 0 ? { isValid: false, errorLogs: errors } : { isValid: true };
}

const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate");

builder.addConditionalEdges("validate", (s) => (s.isValid || s.attempts >= 3 ? END : "analyze"));

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
