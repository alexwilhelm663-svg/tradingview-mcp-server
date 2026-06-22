import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import Groq from "groq-sdk";
import { getElliottWaveSystemPrompt } from "./prompt";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V57: Token-Optimized Mode (2y Data) aktiv...");

function parseWavesFromJson(text: string) {
  try {
    const parsed = JSON.parse(text);
    if (parsed.waves && Array.isArray(parsed.waves)) return parsed.waves;
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch (e) { 
    const match = text.match(/\[.*\]/s);
    try { return match ? JSON.parse(match[0]) : null; } catch(err) { return null; }
  }
}

// =========================================================================
// OPTIMIERTER DATEN-ABRUF: Reduziert auf 2 Jahre, um das 6k-Token-Limit zu unterbieten
// =========================================================================
async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  // range=2y reduziert den Token-Footprint um >50% und hält uns unter dem 6k TPM Limit
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=2y`;
  
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Kursdaten gefunden.");

  const timestamps = chartData.timestamp || [];
  const quote = chartData.indicators?.quote?.[0] || {};
  const opens = quote.open || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];

  const rawCandles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (opens[i] == null || highs[i] == null || lows[i] == null) continue;
    rawCandles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: Number(opens[i]).toFixed(4),
      high: Number(highs[i]).toFixed(4),
      low: Number(lows[i]).toFixed(4),
      close: Number(closes[i]).toFixed(4)
    });
  }
  return rawCandles;
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, validationData: { valid: boolean, message: string } | null, rawStderr: string }> {
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
      resolve({ pngBuffer: stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null, validationData: val, rawStderr: stderrStr });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Bitte Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Ziehe 2-Jahres-Stream (Token-Optimized): ${cleanSymbol}...`);

  let candles: any[] = [];
  try { candles = await fetchVanillaYahooCandles(cleanSymbol); } catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  let iteration = 0;
  let criticRejection = "";
  let finalPhoto: Buffer | null = null;
  let finalResponseText = "";
  const currentModel = "llama-3.1-8b-instant";

  await ctx.reply(`⚡ LPU-Engine (${currentModel}) feuert...`);

  while (iteration < 3) {
    iteration++;
    try {
      let promptText = "Führe die Wellenzählung durch und antworte AUSSCHLIESSLICH als JSON-Objekt mit dem Key 'waves'.";
      if (criticRejection) promptText = `KORREKTUR: "${criticRejection.substring(0, 50)}". Liefert JSON-Objekt mit Key 'waves'.`;

      const res = await groq.chat.completions.create({
        model: currentModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: promptText }
        ],
        response_format: { type: "json_object" },
        temperature: 0.1
      });

      const llmRawAnswer = res.choices[0]?.message?.content || "";
      const waves = parseWavesFromJson(llmRawAnswer);
      
      if (!waves || !Array.isArray(waves) || waves.length === 0 || !waves[0].label) { 
        criticRejection = "Struktur-Fehler"; continue; 
      }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        finalResponseText = llmRawAnswer;
        break;
      }
      criticRejection = py.validationData?.message || py.rawStderr || "Topologie-Fehler";
      await ctx.reply(`🔄 [Runde ${iteration}/3] Veto: "${criticRejection.substring(0, 100)}"`);
    } catch(e: any) {
        await ctx.reply(`⚠️ Groq-Fehler: \n\`${e.message || "Timeout"}\``);
        await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ **Abbruch.** Letztes Veto:\n\`\`\`text\n${criticRejection.substring(0, 500)}\n\`\`\``);

  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View (${currentModel}): ${cleanSymbol}` });
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
