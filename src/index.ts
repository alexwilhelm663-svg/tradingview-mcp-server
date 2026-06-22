import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V62: Structural JSON-Guardrail aktiv...");

function parseWavesFromJson(text: string) {
  try {
    const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.waves && Array.isArray(parsed.waves)) return parsed.waves;
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch (e) { return null; }
}

async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=5y`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Daten.");
  
  const timestamps = chartData.timestamp || [];
  const quote = chartData.indicators?.quote?.[0] || {};
  const rawCandles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null) continue;
    rawCandles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: Number(quote.open[i]).toFixed(4),
      high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4),
      close: Number(quote.close[i]).toFixed(4)
    });
  }
  return rawCandles;
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, validationData: any | null, rawStderr: string }> {
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
      resolve({ pngBuffer: stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null, validationData: val, rawStderr: stderrStr });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Bitte Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Ziehe Stream: ${cleanSymbol}...`);
  let candles: any[] = [];
  try { candles = await fetchVanillaYahooCandles(cleanSymbol); } catch (e: any) { return ctx.reply(`❌ Fehler: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  const modelLite = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", systemInstruction: systemPrompt });
  const modelPro = genAI.getGenerativeModel({ model: "gemini-3.5-flash", systemInstruction: systemPrompt });

  let iteration = 0;
  let criticRejection = "Start";
  let finalPhoto: Buffer | null = null;

  await ctx.reply(`⚡ Analyse startet...`);

  while (iteration < 3) {
    iteration++;
    let currentModel = modelLite;
    try {
      const promptText = `Analyseergebnis als JSON. WICHTIG: Jedes Wellen-Objekt MUSS die Keys 'label', 'date' und 'price' enthalten. ${criticRejection}`;
      const result = await currentModel.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const llmRawAnswer = result.response.text();
      const waves = parseWavesFromJson(llmRawAnswer);
      
      // STRUKTUR-WACHE
      if (!waves || !Array.isArray(waves)) { criticRejection = "JSON ist kein Array"; continue; }
      const hasLabels = waves.every((w: any) => w.hasOwnProperty('label') && w.hasOwnProperty('date') && w.hasOwnProperty('price'));
      if (!hasLabels) { criticRejection = "Fehlende Keys ('label', 'date', 'price')"; continue; }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        break;
      }
      criticRejection = py.validationData?.message || "Topologie-Fehler";
      await ctx.reply(`🔄 [Runde ${iteration}] Veto: ${criticRejection}`);
    } catch(e: any) {
        await ctx.reply(`⚠️ Fehler: ${e.message}`);
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch. Letztes Veto: ${criticRejection}`);
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 View: ${cleanSymbol}` });
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => { res.writeHead(200); res.end("ok"); try { bot.handleUpdate(JSON.parse(body)); } catch (e) {} });
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
