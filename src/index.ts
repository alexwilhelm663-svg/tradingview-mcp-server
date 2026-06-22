import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V64: Structural Guardrail (Label-Enforcer) aktiv...");

// Der Struktur-Wächter: Prüft jedes Wellen-Objekt auf den Key 'label'
function validateWaveStructure(waves: any[]) {
    if (!Array.isArray(waves)) return "Nicht als Array formatiert.";
    for (let i = 0; i < waves.length; i++) {
        if (!waves[i].label) return `Welle an Index ${i} hat keinen 'label'-Key!`;
    }
    return null; // Alles okay
}

function parseWavesFromJson(text: string) {
  try {
    const jsonStr = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(jsonStr);
    return data.waves || data; 
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

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, error: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [], stderrStr = "";
    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());
    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();
    pyProcess.on("close", (code) => {
      if (code !== 0) return resolve({ pngBuffer: null, error: `Python Exit ${code}: ${stderrStr}` });
      resolve({ pngBuffer: stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null, error: null });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol?");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Stream: ${cleanSymbol}...`);
  let candles: any[] = [];
  try { candles = await fetchVanillaYahooCandles(cleanSymbol); } catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);
  const modelLite = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", systemInstruction: systemPrompt });

  let iteration = 0;
  let lastError = "Start";
  let finalPhoto: Buffer | null = null;

  while (iteration < 3) {
    iteration++;
    try {
      const result = await modelLite.generateContent({
        contents: [{ role: "user", parts: [{ text: `Analysiere EW. FEHLER BEIM LETZTEN MAL: ${lastError}. JSON mit Key 'waves' MUSS zwingend 'label', 'date' und 'price' haben!` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const waves = parseWavesFromJson(result.response.text());
      // WÄCHTER-CHECK
      const structuralError = validateWaveStructure(waves);
      if (structuralError) {
          lastError = structuralError;
          await ctx.reply(`🔄 [Runde ${iteration}] Struktur-Fehler: ${lastError}`);
          continue;
      }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (!py.error && py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break;
      }
      lastError = py.error || "Topologie-Fehler";
      await ctx.reply(`🔄 [Runde ${iteration}] Python sagt: ${lastError.substring(0, 50)}`);
    } catch(e: any) {
        await ctx.reply(`⚠️ API-Fehler: ${e.message}`);
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch. Letztes Veto: ${lastError}`);
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View: ${cleanSymbol}` });
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
