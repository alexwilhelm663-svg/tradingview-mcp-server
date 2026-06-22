import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import yahooFinance from "yahoo-finance2"; // CORRECT IMPORT
import { getElliottWaveSystemPrompt } from "./prompt";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft: Import-Fix (v36) - Yahoo-Finance Objekt-Instanz behoben...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromJson(text: string) {
  try {
    const jsonStr = text.match(/\[.*\]/s)?.[0] || text;
    return JSON.parse(jsonStr);
  } catch (e) { return null; }
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, validationData: { valid: boolean, message: string } | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
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

  await ctx.reply(`⏳ Scanne Yahoo: ${symbol}...`);

  let candles: any[] = [];
  try {
    // CORRECT USAGE OF YF2
    const res = await yahooFinance.historical(symbol, { period1: "2020-01-01", period2: new Date(), interval: "1wk" });
    candles = res.map(c => ({
        date: c.date.toISOString().split('T')[0],
        high: Number(c.high).toFixed(4),
        low: Number(c.low).toFixed(4),
        close: Number(c.close).toFixed(4)
    })).filter(c => Number(c.high) > 0);
  } catch (e: any) { return ctx.reply(`❌ Yahoo: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.high},${c.low}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  let iteration = 0;
  let criticRejection = "";
  let finalPhoto = null;
  let finalResponse = "";

  while (iteration < 3) {
    iteration++;
    try {
      const prompt = criticRejection ? `Fehler: ${criticRejection}. Korrigiere die Tabelle.` : "Analysiere den Kurs-Stream.";
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { 
            systemInstruction: systemPrompt + "\n\nAUSGABE: JSON-Array: [{\"label\": \"I\", \"date\": \"YYYY-MM-DD\", \"price\": 123.45}, ...]",
            maxOutputTokens: 8192 
        }
      });

      const waves = parseWavesFromJson(res.text || "");
      if (!waves) { criticRejection = "Kein valides JSON"; continue; }

      const py = await runPythonCritic(symbol, waves, candles);
      if (py.validationData?.valid) {
        finalPhoto = py.pngBuffer;
        finalResponse = res.text || "";
        break;
      }
      criticRejection = py.validationData?.message || "Topologie-Fehler.";
    } catch(e: any) {
        await ctx.reply(`⚠️ API-Stau. Warte 60s...`);
        await new Promise(r => setTimeout(r, 60000));
    }
  }

  if (!finalPhoto) return ctx.reply("❌ Abbruch. KI-Topologie fehlgeschlagen.");
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View: ${symbol}` });
});

bot.launch();
