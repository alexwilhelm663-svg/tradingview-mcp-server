import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";
import { getElliottWaveSystemPrompt } from "./prompt";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft in der Cloud mit Scope-fixierter Pipeline & 4-Dezimalen-Quant-Engine (v33)...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromText(text: string): Array<{ label: string; date: string; price: number }> {
  const waves: Array<{ label: string; date: string; price: number }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
    
    if (parts.length >= 2 && /\d/.test(parts[1])) {
        let label = parts[0].replace(/[\*\`]/g, '').trim(); 
        label = label.replace(/^(?:Welle|Wave|Top|Bottom|Punkt|Pivot)\s+/i, '').trim();
        
        const rawDate = parts[1].replace(/[\*\`\[\]]/g, '').trim();
        
        let price = 0;
        if (parts.length >= 3) {
            const priceMatch = parts[2].match(/[-0-9.,]+/);
            if (priceMatch) price = parseFloat(priceMatch[0].replace(',', '.'));
        }
        
        if (label && rawDate) {
            waves.push({ label, date: rawDate, price });
        }
    }
  }

  return waves;
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errLog: string, validationData: { valid: boolean, message: string } | null }> {
  return new Promise((resolve) => {
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pyProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
    
    const stdoutBufs: Buffer[] = [];
    let stderrStr = "";

    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();

    pyProcess.on("close", () => {
      let val = null;
      try {
        const parsed = JSON.parse(stderrStr);
        if (parsed.validation) val = parsed.validation;
      } catch(e) {}

      const photoBuf = stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null;
      resolve({ pngBuffer: photoBuf, errLog: stderrStr, validationData: val });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(" ");
  const symbol = args[1];
  const isDebug = ctx.message.text.toLowerCase().includes("debug");
  
  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an!");

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) cleanSymbol = cleanSymbol.split(":").pop()!;

  await ctx.reply(`⏳ Scanne Yahoo-Server für ${cleanSymbol}...`);

  let candlesArray: any[] = [];
  try {
    const res = await yahooFinance.historical(cleanSymbol, { period1: "1970-01-01", period2: new Date(), interval: "1wk" });
    candlesArray = res.map(c => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(4), high: Number(c.high).toFixed(4),
      low: Number(c.low).toFixed(4), close: Number(c.close).toFixed(4)
    })).filter(c => Number(c.open) > 0);
  } catch (e: any) { return ctx.reply(`❌ Yahoo: ${e.message}`); }

  const minifiedMarketStream = candlesArray.map(c => `${c.date},${c.high},${c.low}`).join("|");
  const basePrompt = getElliottWaveSystemPrompt(candlesArray[0].date, candlesArray[candlesArray.length-1].date, minifiedMarketStream);

  // === SCOPE FIX: Variablen hier deklariert ===
  let currentPrompt = basePrompt;
  let topologyIteration = 0;
  const maxTopologyIterations = 3;
  let criticRejectionReason = "";
  
  let finalResponseText = "";
  let finalErrLogLog = "";
  let finalPhotoBuffer: Buffer | null = null;
  
  const modelPool = ["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-pro"];

  await ctx.reply(`⏳ Pipeline gestartet (Max 3 Zyklen)...`);

  while (topologyIteration < maxTopologyIterations) {
    const activeModel = modelPool[topologyIteration];

    if (criticRejectionReason) {
      await ctx.reply(`⚠️ Veto (Runde ${topologyIteration}): "${criticRejectionReason}"...`);
      currentPrompt = `KORREKTUR-ZYKLUS: Korrigiere den topologischen Fehler: "${criticRejectionReason}". Gib nur die korrigierte, vollständige Tabelle aus!`;
    }

    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: currentPrompt,
        config: { systemInstruction: basePrompt, maxOutputTokens: 8192 }
      });
      const llmRawAnswer = response.text || "";
      const candidateWaves = parseWavesFromText(llmRawAnswer);
      
      if (candidateWaves.length === 0) { criticRejectionReason = "Keine Tabelle gefunden."; continue; }

      const pyCritic = await runPythonCritic(cleanSymbol, candidateWaves, candlesArray);
      if (pyCritic.validationData && pyCritic.validationData.valid) {
        finalPhotoBuffer = pyCritic.pngBuffer;
        finalErrLogLog = pyCritic.errLog;
        finalResponseText = llmRawAnswer;
        break;
      }
      criticRejectionReason = pyCritic.validationData?.message || "Unbekannter Geometrie-Fehler.";
    } catch(apiErr: any) {
        await new Promise(r => setTimeout(r, 45000));
        continue;
    }
    topologyIteration++;
  }

  if (!finalPhotoBuffer) return ctx.reply("❌ Abbruch nach 3 Zyklen.");

  await ctx.replyWithPhoto({ source: finalPhotoBuffer }, { caption: `📊 EW View: ${cleanSymbol}` });
  for (let i = 0; i < finalResponseText.length; i += 3800) await ctx.reply(finalResponseText.substring(i, i + 3800));
});

bot.launch();
