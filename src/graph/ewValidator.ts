import { z } from "zod";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const dbPath = path.join(DATA_DIR, "radar_state.db");
const memory = new SqliteSaver({ dbPath });

// NEU: Schema trennt strikt zwischen laufender Welle 5 und abgeschlossener Welle 5
const WaveCountSchema = z.object({
  trend: z.enum(["bullish", "bearish"]),
  status: z.enum(["in_progress", "completed"]).describe("Setze 'in_progress' wenn Welle 5 aktuell noch läuft oder der Kurs gerade über Welle 3 ausbricht. Setze 'completed' NUR wenn Welle 5 definitiv am Hoch abgeschlossen ist."),
  points: z.object({
    start: z.number().describe("Preis am Startpunkt (0)"),
    wave1: z.number().describe("Preis am Endpunkt von Welle 1"),
    wave2: z.number().describe("Preis am Endpunkt von Welle 2"),
    wave3: z.number().describe("Preis am Endpunkt von Welle 3"),
    wave4: z.number().describe("Preis am Endpunkt von Welle 4"),
    wave5: z.number().describe("Preis am Endpunkt von Welle 5 (oder kalkuliertes Extensionsziel falls noch in_progress)"),
  }),
  targets: z.object({
    ext100: z.number().optional().describe("Fibonacci Extension 1.0 nach oben (nur bei in_progress)"),
    ext1618: z.number().optional().describe("Fibonacci Extension 1.618 nach oben (nur bei in_progress)"),
    ret382: z.number().optional().describe("Fib 0.382 Retracement nach unten (nur bei completed)"),
    ret500: z.number().optional().describe("Fib 0.500 Retracement nach unten (nur bei completed)"),
    ret618: z.number().optional().describe("Golden Pocket 0.618 nach unten (nur bei completed)"),
  }),
  analysis: z.string().describe("Kurze Begründung des Setups"),
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
  attempts: Annotation<number>({
    reducer: (current: number, next: number) => current + next,
    default: () => 0,
  }),
});

async function analyzeNode(state: typeof RadarState.State) {
  console.log(`\n[Node: Analyze] Analysiere ${state.symbol} (Versuch ${state.attempts + 1})`);
  
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY fehlt in der .env Datei");
  }

  const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1,
  }).withStructuredOutput(WaveCountSchema);

  let prompt = `Analysiere die Elliott-Wellen für ${state.symbol} basierend auf diesen Daten: ${JSON.stringify(state.marketData)}.
WICHTIG FÜR DEN STATUS:
- Wenn der aktuelle Kurs nahe am Welle-3-Hoch liegt oder gerade über Welle 3 ausbricht, befindet sich der Markt in Welle 5 -> Setze status="in_progress" und berechne in 'targets' die Extensionen nach oben (ext100, ext1618).
- Setze status="completed" NUR dann, wenn ein eindeutiges Top bei Welle 5 gebildet wurde und der Kurs bereits abdreht -> Berechne erst DANN die Retracements nach unten (ret382, ret500, ret618).`;
  
  if (state.errorLogs.length > 0) {
    prompt += `\n\nACHTUNG Regelverstöße beim vorherigen Versuch:\n- ${state.errorLogs.join("\n- ")}`;
  }

  const response = await llm.invoke(prompt);
  return { waveCount: response, attempts: 1 };
}

async function validateNode(state: typeof RadarState.State) {
  console.log(`[Node: Validate] Prüfe Elliott-Wellen-Regeln für ${state.symbol}...`);
  const count = state.waveCount;
  
  if (!count) return { isValid: false, errorLogs: ["Keine Zählung generiert."] };

  const errors: string[] = [];
  const p = count.points;

  if (count.trend === "bullish") {
    if (p.wave2 <= p.start) errors.push(`Welle 2 (${p.wave2}) fällt unter Startpunkt (${p.start}).`);
    
    const len1 = p.wave1 - p.start;
    const len3 = p.wave3 - p.wave2;
    const len5 = p.wave5 - p.wave4;
    
    if (len3 < len1 && len3 < len5) {
      errors.push(`Welle 3 (${len3.toFixed(2)}) ist die kürzeste Impulswelle. Verboten.`);
    }

    if (p.wave4 <= p.wave1) {
      errors.push(`Welle 4 (${p.wave4}) überschneidet Welle 1 (${p.wave1}).`);
    }
  }

  if (errors.length > 0) {
    console.warn(`[Warnung] Zählung fehlerhaft: ${errors.join(" ")}`);
    return { isValid: false, errorLogs: errors };
  }

  console.log("[Erfolg] Die Zählung entspricht den Regeln!");
  return { isValid: true, errorLogs: [] };
}

const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate");

builder.addConditionalEdges("validate", (state: typeof RadarState.State) => {
  if (state.isValid) return END;
  if (state.attempts >= 3) return END;
  return "analyze";
});

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });
