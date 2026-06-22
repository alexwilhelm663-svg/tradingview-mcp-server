import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2"; // DIE VOM COMPILER GEFORDERTE DEFAULT-KLASSE
import { getElliottWaveSystemPrompt } from "./prompt";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance(); // REKORREKTE INSTANZIERUNG DES DEFAULT-EXPORTS
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft: Default Import-Fix & JSON-Pipeline (v39)...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromJson(text: string) {
  try {
    const match = text.match(/\[.*\]/s);
    const jsonStr = match ? match[0] : text;
    return JSON.parse(jsonStr);
  } catch (e) { return null; }
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, validationData: { valid: boolean, message: string } | null }> {
  return new Promise((resolve) => {
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pyProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [], stderrStr = "";

    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();

    pyProcess.on("close", () => {
      let val = null;
      try { val = JSON.parse(stderrStr).validation; } catch(e) {}
      resolve({ pngBuffer: stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null, validationData: val });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbol = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!symbol) return ctx.reply("❌ Bitte Symbol angeben!");
  const cleanSymbol = symbol.trim().split(":").pop()!;

  await ctx.reply(`⏳ Scanne Yahoo: ${cleanSymbol} (Letzte 5 Jahre)...`);

  let candles: any[] = [];
  try {
    const rawResult = await yahooFinance.historical(cleanSymbol, { 
      period1: "2020-01-01", 
      period2: new Date(), 
      interval: "1wk" 
    }) as any[];

    candles = rawResult.map(c => ({
        date: c.date.toISOString().split('T')[0],
        high: Number(c.high).toFixed(4),
        low: Number(c.low).toFixed(4),
        close: Number(c.close).toFixed(4)
    })).filter(c => Number(c.high) > 0);
  } catch (e: any) { return ctx.reply(`❌ Yahoo Fehler: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.high},${c.low}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  let iteration = 0;
  let criticRejection = "";
  let finalPhoto: Buffer | null = null;
  let finalResponseText = "";

  await ctx.reply(`⏳ Actor-Critic JSON-Pipeline aktiv...`);

  while (iteration < 3) {
    iteration++;
    try {
      const promptText = criticRejection ? `Fehler: ${criticRejection}. Korrigiere das JSON-Array.` : "Analysiere den Kurs-Stream.";
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: promptText,
        config: { 
            systemInstruction: systemPrompt + "\n\nAUSGABE: Gib AUSSCHLIESSLICH ein sauberes JSON-Array zurück: [{\"label\": \"I\", \"date\": \"YYYY-MM-DD\", \"price\": 123.45}, ...]",
            maxOutputTokens: 8192 
        }
      });

      const waves = parseWavesFromJson(res.text || "");
      if (!waves) { criticRejection = "Kein syntaktisch valides JSON"; continue; }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        finalResponseText = res.text || "";
        break;
      }
      criticRejection = py.validationData?.message || "Topologie-Fehler.";
    } catch(e: any) {
        await ctx.reply(`⚠️ API-Stau. Warte 60s...`);
        await new Promise(r => setTimeout(r, 60000));
    }
  }

  if (!finalPhoto) return ctx.reply("❌ Abbruch. KI konnte die Chart-Topologie nicht in 3 Versuchen auflösen.");
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View: ${cleanSymbol}` });
  
  if (finalResponseText.trim()) {
    await ctx.reply(`💬 Rohes Wellen-JSON:\n\`\`\`json\n${finalResponseText.substring(0, 3800)}\n\`\`\``);
  }
});

bot.launch();
