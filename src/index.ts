import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V70: LLM-X-Ray Engine (Deep JSON Inspection) aktiv...");

// DER NEUE, AGGRESSIVE PARSER: Findet das Array, egal wo es steckt
function inspectAndExtractWaves(rawText: string): { waves: any[] | null, error: string | null } {
  try {
    const clean = rawText.replace(/^```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const data = JSON.parse(clean);

    let arr: any[] | null = null;
    if (Array.isArray(data)) arr = data;
    else if (data.waves && Array.isArray(data.waves)) arr = data.waves;
    else if (data.data && Array.isArray(data.data)) arr = data.data;
    else {
      // Sucht im gesamten Objekt nach dem ersten Array, das er finden kann
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) { arr = data[key]; break; }
      }
    }

    if (!arr) return { waves: null, error: `JSON geparst, aber kein Array gefunden. Vorhandene Keys: [${Object.keys(data).join(", ")}]` };
    if (arr.length === 0) return { waves: null, error: "Das gefundene Array war leer []" };

    // Stichprobe am ersten Element
    const first = arr[0];
    if (!first.hasOwnProperty("label") || !first.hasOwnProperty("date") || !first.hasOwnProperty("price")) {
      return { waves: null, error: `Falsches Objekt-Schema im Array. Gefundenes Item 0: ${JSON.stringify(first)}` };
    }

    return { waves: arr, error: null };
  } catch (e: any) {
    return { waves: null, error: `JSON-Parse-Crash (${e.message}). \nLLM-Rohtext-Anfang: "${rawText.substring(0, 120)}..."` };
  }
}

async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=max`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Daten im Yahoo-JSON.");
  
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

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [];
    let stderrStr = "";

    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();

    pyProcess.on("close", (code) => {
      const trimmedStderr = stderrStr.trim();
      if (code !== 0) return resolve({ pngBuffer: null, errorMessage: `Python System Crash [Exit ${code}]:\n${trimmedStderr}` });

      if (trimmedStderr.length > 0) {
        try {
          const parsed = JSON.parse(trimmedStderr);
          if (parsed.validation && parsed.validation.valid === false) {
            return resolve({ pngBuffer: null, errorMessage: parsed.validation.message || JSON.stringify(parsed.validation) });
          }
        } catch (e) {
          if (stdoutBufs.length === 0) return resolve({ pngBuffer: null, errorMessage: `Python Ablehnung: ${trimmedStderr}` });
        }
      }

      if (stdoutBufs.length > 0) return resolve({ pngBuffer: Buffer.concat(stdoutBufs), errorMessage: null });
      resolve({ pngBuffer: null, errorMessage: "Python beendete den Prozess ohne Bildausgabe." });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Historie: ${cleanSymbol}...`);
  let candles: any[] = [];
  try { candles = await fetchVanillaYahooCandles(cleanSymbol); } catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);
  const modelLite = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", systemInstruction: systemPrompt });

  let iteration = 0;
  let rejectionReason = "";
  let finalPhoto: Buffer | null = null;

  while (iteration < 3) {
    iteration++;
    try {
      const promptText = iteration === 1 
        ? `Führe die Elliott-Wellen-Zählung für die Historie durch. 
WICHTIG: Antworte AUSSCHLIESSLICH mit einem JSON-Objekt. 
Dieses JSON muss zwingend ein Array namens "waves" enthalten.
Jedes Element im Array MUSS exakt diese Struktur haben:
{
  "label": "0",
  "date": "YYYY-MM-DD",
  "price": 123.45
}`
        : `🔴 KORREKTUR! Dein letzter Output war fehlerhaft. Grund der Ablehnung:\n"${rejectionReason}"\n\nBehebe diesen exakten Fehler und liefere das korrekte JSON!`;

      const result = await modelLite.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        // Zwingt die Google-API auf Protokollebene dazu, reines JSON zu spucken
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const rawLlmAnswer = result.response.text();
      const inspection = inspectAndExtractWaves(rawLlmAnswer);

      if (!inspection.waves) {
        rejectionReason = inspection.error!;
        await ctx.reply(`🔄 [Runde ${iteration}] JSON-Inspektion Veto: \n\`\`\`text\n${rejectionReason}\n\`\`\``);
        continue;
      }

      const py = await runPythonCritic(cleanSymbol, inspection.waves, candles);
      if (py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break; 
      }

      rejectionReason = py.errorMessage || "Geometrie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration}] Python-Veto: ${rejectionReason}`);

    } catch(e: any) {
        await ctx.reply(`⚠️ API-Fehler: ${e.message}`);
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch nach 3 Zyklen.\n\nLetzter Fehlerstand:\n\`\`\`text\n${rejectionReason}\n\`\`\``);
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
