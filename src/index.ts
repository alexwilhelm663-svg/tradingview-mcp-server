import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import Groq from "groq-sdk";
import { getElliottWaveSystemPrompt } from "./prompt";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V47: Python Stderr-Unmasking & Live-Feedback aktiv...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

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

async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=5y`;
  
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
  });
  
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  
  const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Kursdaten im Yahoo-JSON.");

  const timestamps = chartData.timestamp || [];
  const quote = chartData.indicators?.quote?.[0] || {};
  const highs = quote.high || [];
  const lows = quote.low || [];
  const closes = quote.close || [];

  const candles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (highs[i] == null || lows[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    candles.push({
      date: dateStr,
      high: Number(highs[i]).toFixed(4),
      low: Number(lows[i]).toFixed(4),
      close: Number(closes[i]).toFixed(4)
    });
  }
  return candles;
}

// =========================================================================
// DER SCHEINWERFER: Gibt jetzt zwingend die rohe Python-Fehlerausgabe mit!
// =========================================================================
function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ 
  pngBuffer: Buffer | null, 
  validationData: { valid: boolean, message: string } | null,
  rawStderr: string 
}> {
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
      resolve({ 
        pngBuffer: stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null, 
        validationData: val,
        rawStderr: stderrStr // <--- HIER STECKT DIE WAHRHEIT DRIN
      });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Bitte Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Ziehe V8-Kurse: ${cleanSymbol}...`);

  let candles: any[] = [];
  try {
    candles = await fetchVanillaYahooCandles(cleanSymbol);
  } catch (e: any) { return ctx.reply(`❌ Download-Fehler: ${e.message}`); }

  const minifiedMarketStream = candles.map(c => `${c.date},${c.high},${c.low}`).join("|");
  const systemPrompt = getElliottWaveSystemPrompt(candles[0].date, candles[candles.length-1].date, minifiedMarketStream);

  let iteration = 0;
  let criticRejection = "";
  let finalPhoto: Buffer | null = null;
  let finalResponseText = "";

  await ctx.reply(`⚡ LPU-Engine getriggert (Modell: llama-3.3-70b-versatile)...`);

  while (iteration < 3) {
    iteration++;
    try {
      const promptText = criticRejection 
        ? `Fehler: ${criticRejection}. Gib das JSON-Objekt korrigiert zurück.` 
        : `Analysiere den Kurs-Stream.`;

      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          { 
            role: "system", 
            content: systemPrompt + "\n\nZWANGS-FORMAT: Du MUSST ein JSON-Objekt mit dem Key 'waves' liefern!\nBeispiel: { \"waves\": [ {\"label\": \"I\", \"date\": \"2024-01-01\", \"price\": 100.0} ] }" 
          },
          { role: "user", content: promptText }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      const llmRawAnswer = res.choices[0]?.message?.content || "";
      const waves = parseWavesFromJson(llmRawAnswer);
      
      if (!waves) { 
        criticRejection = "KI lieferte kein gültiges 'waves'-Array"; 
        await ctx.reply(`🔄 [Runde ${iteration}/3] KI-JSON Syntax unlesbar. Starte Neuversuch...`);
        continue; 
      }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        finalResponseText = llmRawAnswer;
        break;
      }

      // =====================================================================
      // DIE WAHRHEIT INS TELEGRAM:
      // Wenn val null ist (Python-Absturz), schickt er den Traceback ins Chat!
      // =====================================================================
      const actualError = py.validationData?.message || py.rawStderr || "Stummer Python-Crash";
      criticRejection = actualError;
      
      await ctx.reply(`🔄 [Runde ${iteration}/3] Python-Veto: "${actualError.substring(0, 200)}..."`);
      
    } catch(e: any) {
        await ctx.reply(`⚠️ Groq-Systemfehler: \n\`${e.message || "Unknown"}\``);
        await new Promise(r => setTimeout(r, 2000));
    }
  }

  if (!finalPhoto) {
    return ctx.reply(`❌ **Endgültiger Abbruch nach 3 Versuchen.**\n\nRoher Python-Befund:\n\`\`\`text\n${criticRejection.substring(0, 1500)}\n\`\`\``);
  }

  chatSessions[chatId] = {
    lastDataPayload: { candles, waves: parseWavesFromJson(finalResponseText) },
    history: [{ role: "user", content: "Analysiert." }, { role: "assistant", content: finalResponseText }]
  };

  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View via Groq: ${cleanSymbol}` });
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        res.writeHead(200); res.end("ok");
        try { bot.handleUpdate(JSON.parse(body)); } catch (e) {}
      });
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
