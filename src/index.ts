import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V58: Gemini 1.5 Flash Engine (Unlimited Context) aktiv...");

function parseWavesFromJson(text: string) {
  try {
    const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.waves && Array.isArray(parsed.waves)) return parsed.waves;
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch (e) { 
    const match = text.match(/\[.*\]/s);
    try { return match ? JSON.parse(match[0]) : null; } catch(err) { return null; }
  }
}

async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  // Wir ziehen jetzt wieder 5 Jahre, da Gemini den Platz hat!
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

  await ctx.reply(`⏳ Ziehe 5-Jahres-Stream via Google Cloud: ${cleanSymbol}...`);

  let candles: any[] = [];
  try { candles = await fetchVanillaYahooCandles(cleanSymbol); } catch (e: any) { return ctx.reply(`❌ Fehler: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  // Gemini Setup
  const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: systemPrompt
  });

  let iteration = 0;
  let criticRejection = "";
  let finalPhoto: Buffer | null = null;
  let finalResponseText = "";

  await ctx.reply(`⚡ Gemini 1.5 Flash (Context: Unlimited) aktiv...`);

  while (iteration < 3) {
    iteration++;
    try {
      const promptText = criticRejection 
        ? `KORREKTUR: "${criticRejection.substring(0, 50)}". Antworte zwingend als JSON mit Key 'waves'.` 
        : `Analysiere den Kurs-Stream.`;

      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const llmRawAnswer = result.response.text();
      const waves = parseWavesFromJson(llmRawAnswer);
      
      if (!waves || !Array.isArray(waves)) { criticRejection = "Strukturfehler"; continue; }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        finalResponseText = llmRawAnswer;
        break;
      }
      criticRejection = py.validationData?.message || py.rawStderr || "Topologie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration}/3] Veto: "${criticRejection.substring(0, 100)}"`);
    } catch(e: any) {
        await ctx.reply(`⚠️ Gemini-API Fehler: \n\`${e.message}\``);
        await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch. Letztes Veto: ${criticRejection}`);
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View via Gemini: ${cleanSymbol}` });
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
