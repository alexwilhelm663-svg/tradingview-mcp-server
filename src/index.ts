import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";
import Groq from "groq-sdk";
import { getElliottWaveSystemPrompt } from "./prompt";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const yahooFinance = new YahooFinance();
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft: GROQ Engine v42 mit Render-Webhook-Verkabelung aktiv.");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "assistant"; content: string }>;
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
  const chatId = ctx.chat.id;
  const symbol = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!symbol) return ctx.reply("❌ Bitte Symbol angeben! Beispiel: /analyse NVDA");
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

  await ctx.reply(`⚡ Pipeline aktiv via Groq LPU (llama3-70b-8192)...`);

  while (iteration < 3) {
    iteration++;
    try {
      const promptText = criticRejection 
        ? `Fehler: ${criticRejection}. Korrigiere das JSON-Array.` 
        : `Analysiere den Kurs-Stream.`;

      const res = await groq.chat.completions.create({
        model: "llama3-70b-8192",
        messages: [
          { role: "system", content: systemPrompt + "\n\nAUSGABE: JSON-Array: [{\"label\": \"Welle\", \"date\": \"YYYY-MM-DD\", \"price\": 0.0000}]" },
          { role: "user", content: promptText }
        ],
        response_format: { type: "json_object" },
        temperature: 0.2
      });

      const llmRawAnswer = res.choices[0]?.message?.content || "";
      const waves = parseWavesFromJson(llmRawAnswer);
      
      if (!waves) { criticRejection = "Kein syntaktisch valides JSON"; continue; }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      if (py.validationData && py.validationData.valid) {
        finalPhoto = py.pngBuffer;
        finalResponseText = llmRawAnswer;
        break;
      }
      criticRejection = py.validationData?.message || "Topologie-Fehler.";
    } catch(e: any) {
        await ctx.reply(`⚠️ Groq Stau. Warte 10s...`);
        await new Promise(r => setTimeout(r, 10000));
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch. Letzter Befund: "${criticRejection}"`);

  chatSessions[chatId] = {
    lastDataPayload: { candles, waves: parseWavesFromJson(finalResponseText) },
    history: [{ role: "user", content: "Kursdaten analysiert." }, { role: "assistant", content: finalResponseText }]
  };

  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View via Groq: ${cleanSymbol}` });
  
  if (finalResponseText.trim()) {
    await ctx.reply(`💬 Validiertes Wellen-JSON:\n\`\`\`json\n${finalResponseText.substring(0, 3800)}\n\`\`\``);
  }
});

// NATIVE RENDER CLOUD INTERFACES (Verhindert Deployment-Timeouts)
if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        try { if (body.trim()) bot.handleUpdate(JSON.parse(body)); } catch (e) {}
      });
    } else res.end("Bot Server is healthy");
  }).listen(PORT);
} else {
  bot.launch();
}
