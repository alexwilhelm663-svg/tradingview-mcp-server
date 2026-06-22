import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V69: Absolute Truth Engine (Ironclad Stderr Parser) aktiv...");

function parseWavesFromJson(text: string) {
  try {
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(clean);
    if (parsed.waves && Array.isArray(parsed.waves)) return parsed.waves;
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch (e) { 
    const match = text.match(/\[\s*\{.*\}\s*\]/s);
    try { return match ? JSON.parse(match[0]) : null; } catch(err) { return null; }
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

// IRONCLAD PYTHON BRIDGE: Verliert kein einziges Zeichen mehr aus Stderr
function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ 
  pngBuffer: Buffer | null, 
  errorMessage: string | null 
}> {
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

      // Fall 1: Python ist mit einem echten Systemfehler gecrasht (KeyError, Syntax, etc.)
      if (code !== 0) {
        return resolve({ pngBuffer: null, errorMessage: `Python System Crash [Exit ${code}]:\n${trimmedStderr}` });
      }

      // Fall 2: Python lief durch (Exit 0), hat aber eine JSON-Validierungs-Meldung in stderr hinterlassen!
      if (trimmedStderr.length > 0) {
        try {
          const parsed = JSON.parse(trimmedStderr);
          if (parsed.validation && parsed.validation.valid === false) {
            return resolve({ 
              pngBuffer: null, 
              errorMessage: parsed.validation.message || JSON.stringify(parsed.validation) 
            });
          }
        } catch (e) {
          // Es war Text im stderr, kein JSON, aber es existiert Text!
          if (stdoutBufs.length === 0) {
            return resolve({ pngBuffer: null, errorMessage: `Python Ablehnung: ${trimmedStderr}` });
          }
        }
      }

      // Fall 3: Einwandfreier Durchlauf, wir haben ein Bild!
      if (stdoutBufs.length > 0) {
        return resolve({ pngBuffer: Buffer.concat(stdoutBufs), errorMessage: null });
      }

      // Fall 4: Absolutes Geister-Szenario
      resolve({ pngBuffer: null, errorMessage: "Python beendete den Prozess ohne Bildausgabe und ohne Fehlermeldung." });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Ziehe Historie: ${cleanSymbol}...`);
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
        ? `Führe die Elliott-Wellen-Zählung für die gesamte Historie durch. Liefere AUSSCHLIESSLICH ein JSON mit dem Key 'waves'.`
        : `🔴 KORREKTUR-BEFEHL! Dein letzter Versuch wurde von der mathematischen Geometrie-Prüfung abgelehnt. 
Exakter Grund der Ablehnung:
"${rejectionReason}"

Liefere eine neue, korrigierte Zählung, die diesen exakten Fehler behebt!`;

      const result = await modelLite.generateContent({
        contents: [{ role: "user", parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      });

      const waves = parseWavesFromJson(result.response.text());
      if (!waves || !Array.isArray(waves) || waves.length === 0 || !waves[0].label) {
        rejectionReason = "KI lieferte strukturell defektes JSON (Keys fehlen).";
        await ctx.reply(`🔄 [Runde ${iteration}] Veto: ${rejectionReason}`);
        continue;
      }

      const py = await runPythonCritic(cleanSymbol, waves, candles);
      
      if (py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break; // BINGO!
      }

      rejectionReason = py.errorMessage || "Unbekannter Geometrie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration}] Veto-Grund: ${rejectionReason}`);

    } catch(e: any) {
        await ctx.reply(`⚠️ API-Fehler: ${e.message}`);
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch nach 3 Zyklen.\n\nLetzter, ungeschminkter Fehlerbericht:\n\`\`\`text\n${rejectionReason}\n\`\`\``);
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View (Max History): ${cleanSymbol}` });
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
