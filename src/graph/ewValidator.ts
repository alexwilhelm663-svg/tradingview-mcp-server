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

// 2. Erwartetes Output-Format von Gemini definieren
const WaveCountSchema = z.object({
  trend: z.enum(["bullish", "bearish"]),
  points: z.object({
    start: z.number().describe("Preis am Startpunkt (0) der Zählung"),
    wave1: z.number().describe("Preis am Endpunkt von Welle 1"),
    wave2: z.number().describe("Preis am Endpunkt von Welle 2"),
    wave3: z.number().describe("Preis am Endpunkt von Welle 3"),
    wave4: z.number().describe("Preis am Endpunkt von Welle 4"),
    wave5: z.number().describe("Preis am (möglichen) Endpunkt von Welle 5"),
  }),
  analysis: z.string().describe("Kurze Begründung des Setups"),
});

// 3. Status-Objekt des Graphen
export const RadarState = Annotation.Root({
  symbol: Annotation<string>(),
  marketData: Annotation<any>(),
  waveCount: Annotation<z.infer<typeof WaveCountSchema> | null>(),
  isValid: Annotation<boolean>(),
  errorLogs: Annotation<string[]>({
    reducer: (current, next) => current.concat(next),
    default: () => [],
  }),
  attempts: Annotation<number>({
    reducer: (current, next) => current + next,
    default: () => 0,
  }),
});

// 4. Node: Analyse durch Gemini
async function analyzeNode(state: typeof RadarState.State) {
  console.log(`\n[Node: Analyze] Analysiere ${state.symbol} (Versuch ${state.attempts + 1})`);
  
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY fehlt in der .env Datei");
  }

  const llm = new ChatGoogleGenerativeAI({
    modelName: "gemini-1.5-pro",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1, // Sehr niedrig für maximale Präzision
  }).withStructuredOutput(WaveCountSchema);

  let prompt = `Analysiere die Elliott-Wellen für ${state.symbol} basierend auf diesen Kerzendaten/Zusammenfassungen: ${JSON.stringify(state.marketData)}.`;
  
  // Selbstkorrektur-Schleife: Fehler an das LLM zurückfüttern
  if (state.errorLogs.length > 0) {
    prompt += `\n\nACHTUNG: Deine vorherige Zählung war ungültig. Korrigiere zwingend diese Regelverstöße:\n- ${state.errorLogs.join("\n- ")}`;
  }

  const response = await llm.invoke(prompt);

  return { waveCount: response, attempts: 1 };
}

// 5. Node: Mathematische Validierung der Regeln
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
      errors.push(`Welle 3 (${len3.toFixed(2)}) ist die kürzeste Impulswelle. Das ist verboten.`);
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

// 6. Graphen zusammenbauen und kompilieren
const builder = new StateGraph(RadarState)
  .addNode("analyze", analyzeNode)
  .addNode("validate", validateNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "validate");

builder.addConditionalEdges("validate", (state) => {
  if (state.isValid) return END;
  if (state.attempts >= 3) {
    console.error(`[Abbruch] Konnte nach 3 Versuchen keine valide Zählung für ${state.symbol} finden.`);
    return END;
  }
  return "analyze"; // Zurück zu Gemini
});

export const ewAnalyzerWorkflow = builder.compile({ checkpointer: memory });

