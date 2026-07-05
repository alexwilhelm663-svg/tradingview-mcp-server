// @ts-nocheck
import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";

// 1. Ordner für die SQLite-Datenbank sicherstellen
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const dbPath = path.join(DATA_DIR, "radar_state.db");
const memory = new SqliteSaver({ dbPath });

// 2. Erweitertes Institutionelles Schema (Striktes Modell)
const WaveCountSchema = z.object({
  trend: z.enum(["bullish", "bearish"]),
  points: z.object({
    start: z.number().describe("Preis am Startpunkt (0)"),
    wave1: z.number().describe("Preis am Ende Welle 1"),
    wave2: z.number().describe("Preis am Ende Welle 2"),
    wave3: z.number().describe("Preis am Ende Welle 3"),
    wave4: z.number().describe("Preis am Ende Welle 4"),
    wave5: z.number().describe("Preis am Ende Welle 5"),
  }),
  invalidation_level: z.number().describe("Preis-Niveau für Stop-Loss"),
  risk_reward: z.number().describe("Berechnetes RRR"),
  analysis: z.string().describe("Faktenbasierte Begründung ohne Emotionen"),
});

// 3. Status-Objekt (Erweitert um die Fehlerhistorie)
export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  waveCount: Annotation<z.infer<typeof WaveCountSchema> | null>(),
  isValid: Annotation<boolean>(),
  errorLogs: Annotation<string[]>({
    reducer: (current: string[], next: string[]) => current.concat(next),
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (current: number, next: number) => current + next,
    default: () => 0,
  }),
});

// 4. Node: Analyse mit institutionellem Prompt
async function analyzeNode(state: typeof RadarState.State) {
  console.log(`[Analyze] ${state.symbol} (Versuch ${state.attempts + 1})`);
  
  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0, // Strikt auf 0 gesetzt
  }).withStructuredOutput(WaveCountSchema);

  let prompt = `Analysiere ${state.symbol} Elliott-Wellen. Daten: ${JSON.stringify(state.marketData)}.
  DEINE REGELN: 
  - Welle 2 MUSS 0.382-0.786 Retracement von Welle 1 sein.
  - Welle 3 MUSS länger als Welle 1 sein.
  - Welle 4 darf Welle 1 nicht überlappen.`;

  if (state.errorLogs.length > 0) {
    prompt += `\n\nKORRIGIERE ZWINGEND diese Regelverstöße: ${state.errorLogs.join(", ")}`;
  }

  const response = await llm.invoke(prompt);
  return { waveCount: response, attempts: 1 };
}

// 5. Node: Validierung (Die "Türsteher"-Logik)
async function validateNode(state: typeof RadarState.State) {
  const count = state.waveCount;
  if (!count) return { isValid: false, errorLogs: ["Keine Zählung generiert."] };

  const errors: string[] = [];
  const p = count.points;

  // Mathematische Prüfung (Bullish)
  if (count.trend === "bullish") {
    if (p.wave2 <= p.start) errors.push(`Welle 2(${p.wave2}) unter Start(${p.start})`);
    if (p.wave4 <= p.wave1) errors.push(`Welle 4(${p.wave4}) überlappt Welle 1(${p.wave1})`);
    if ((p.wave3 - p.wave2) < (p.wave1 - p.start)) errors.push("Welle 3 kürzer als Welle 1");
  }

  if (errors.length > 0) return { isValid: false, errorLogs: errors };
  return { isValid: true, errorLogs: [] };
}

// 6. Graph-Aufbau
const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate");

builder.addConditionalEdges("validate", (state) => {
  if (state.isValid) return END;
  return state.attempts >= 3 ? END : "analyze";
});

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
