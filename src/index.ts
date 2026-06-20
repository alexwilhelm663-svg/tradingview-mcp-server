import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft in der Cloud mit Fehler-Scanner und X-Ray Debugger...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

// Hybrid-Parser: Sucht zuerst nach der Tabelle, fällt dann auf deinen alten Regex zurück
function parseWavesFromText(text: string): Array<{ label: string; date: string; price: number }> {
  const waves: Array<{ label: string; date: string; price: number }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
    if (parts.length >= 3 && !parts[0].includes('---') && !parts[0].toLowerCase().includes('welle')) {
        const label = parts[0].replace(/[\*\`\[\]]/g, '').trim(); 
        const rawDate = parts[1].replace(/[\*\`\[\]]/g, '').trim();
        const priceMatch = parts[2].match(/[-0-9.,]+/);
        const price = priceMatch ? parseFloat(priceMatch[0].replace(',', '.')) : 0;
        
        if (label && rawDate.length >= 4) {
            waves.push({ label, date: rawDate, price });
        }
    }
  }

  // Fallback, falls Gemini die Tabelle verweigert hat
  if (waves.length === 0) {
      const regex = /\[(?:Welle\s+)?([12345ABCWXYIV]+):\s*(\d{4}-\d{2}-\d{2})\]/gi;
      let match;
      while ((match = regex.exec(text)) !== null) {
        waves.push({ label: match[1].toUpperCase().trim(), date: match[2].trim(), price: 0 });
      }
  }

  return waves;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const rawText = ctx.message.text;
  const args = rawText.split(" ");
  
  const symbol = args[1];
  const isDebug = rawText.toLowerCase().includes("debug");
  
  let requestedInterval = "auto";
  if (args[2] && args[2].toLowerCase() !== "debug") {
      requestedInterval = args[2].toLowerCase().trim();
  }

  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse TEAM (oder /analyse TEAM debug)");

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) cleanSymbol = cleanSymbol.split(":").pop()!;
  if (cleanSymbol === "P911") cleanSymbol = "P911.DE";

  let yahooInterval: "1d" | "1wk" | "1mo" = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  } else if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  }

  if (isDebug) await ctx.reply("🩻 **X-RAY DEBUG-MODUS AKTIV**\nSchalte Datenstrom-Sonden scharf...");
  else await ctx.reply(`⏳ Lade komplette ${finalIntervalLabel}-Historie für ${cleanSymbol}...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setFullYear(period2.getFullYear() - 3); 

    const result = await yahooFinance.historical(cleanSymbol, { period1, period2, interval: yahooInterval }) as any[];
    if (!result || result.length === 0) throw new Error("Yahoo lieferte ein leeres Array.");

    candlesArray = result.map(c => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(2),
      high: Number(c.high).toFixed(2),
      low: Number(c.low).toFixed(2),
      close: Number(c.close).toFixed(2)
    })).filter(c => Number(c.open) > 0);

  } catch (dataError: any) {
    return ctx.reply(`❌ Yahoo Datenfehler: ${dataError.message}`);
  }

  if (isDebug) {
      await ctx.reply(`🩻 **CHECKPOINT 1 (Yahoo API):**\nErfolgreich ${candlesArray.length} Kerzen geladen.\nStart: ${candlesArray[0]?.date} | Ende: ${candlesArray[candlesArray.length-1]?.date}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Rolle und Ziel:
Du bist ein rigoroser Mathematiker und technischer Analyst für das Elliott-Wellen-Prinzip. Analysiere die Kursdaten im JSON-Format.

Daten-Array:
${dataInputJson}

I. Fundamentale Struktur
Der Markt bewegt sich fraktal in 5 Wellen in Richtung des Trends und in 3 Wellen dagegen.

II. Absolute Regeln für Motiv-Wellen
1. Welle 2 korrigiert nie >100% von Welle 1.
2. Welle 4 korrigiert nie >100% von Welle 3.
3. Welle 3 geht über das Ende von Welle 1 hinaus.
4. Welle 3 ist niemals die kürzeste Welle.
5. Kein Overlap zwischen Welle 4 und 1.

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE (ZWINGEND EINHALTEN!):
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem Muster:

| Welle | Datum | Preis |
| --- | --- | --- |
| Start | YYYY-MM-DD | 100.00 |
| 1 | YYYY-MM-DD | 120.00 |
| 2 | YYYY-MM-DD | 105.00 |

Nutze als Bezeichnungen NUR: 0, 1, 2, 3, 4, 5, A, B, C, I, II, III, IV, V.`;

  let responseText = "";
  let attempts = 3; 
  let delay = 2000; 

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
        config: { safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] }
      });
      responseText = response.text || "";
      if (responseText) break;
    } catch (e) {
      attempts--;
      if (attempts === 0) return ctx.reply("❌ Gemini API Timeout.");
      await new Promise(r => setTimeout(r, delay));
    }
  }

  const wavesData = parseWavesFromText(responseText);

  // ==========================================
  // 🚨 DIE PRE-FLIGHT FALLE (Immer scharf)
  // ==========================================
  if (wavesData.length === 0) {
      return ctx.reply(`🚨 **ABBRUCH: Parser-Falle hat ausgelöst!** 🚨\n\nDer TypeScript-Code konnte in Geminis Antwort keine einzige Welle finden. Python wurde NICHT gestartet.\n\n**Hier ist der exakte rohe Text, den Gemini zurückgegeben hat:**\n\n\`\`\`text\n${responseText.substring(0, 3800)}\n\`\`\``);
  }

  if (isDebug) {
      await ctx.reply(`🩻 **CHECKPOINT 2 (Geparste Wellen):**\n\`\`\`json\n${JSON.stringify(wavesData, null, 2)}\n\`\`\``);
  }

  chatSessions[chatId] = {
    lastDataPayload: { candles: candlesArray, waves: wavesData },
    history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: responseText }]
  };

  const jsonArg = JSON.stringify({ symbol: cleanSymbol, waves: wavesData, candles: candlesArray });
  
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  const pythonProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
  
  const stdoutChunks: Buffer[] = [];
  let telemetryJsonStr = "";

  pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  // Wir fangen stderr als reinen Telemetrie-Kanal ab
  pythonProcess.stderr.on("data", (chunk: Buffer) => telemetryJsonStr += chunk.toString());

  pythonProcess.stdin.write(jsonArg);
  pythonProcess.stdin.end();

  pythonProcess.on("close", async (code) => {
    // Wenn Debug an ist, schicken wir zuerst die Python-interne Matrix
    if (isDebug && telemetryJsonStr) {
        await ctx.reply(`🩻 **CHECKPOINT 3 (Python Snapping Matrix):**\n\`\`\`json\n${telemetryJsonStr.substring(0, 3800)}\n\`\`\``);
    }

    if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ **Python Rendering fehlgeschlagen!**\nExit-Code: ${code}\nLog:\n\`\`\`text\n${telemetryJsonStr}\n\`\`\``);
    } else {
        await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 TradingView Macro: ${cleanSymbol} (${finalIntervalLabel})` });
    }
  });
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => bot.handleUpdate(JSON.parse(body)));
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
