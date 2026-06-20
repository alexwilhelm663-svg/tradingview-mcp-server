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

console.log("🤖 Bot läuft in der Cloud mit 10-Jahres-Daten-Pipeline...");

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

  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse MSTR");

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) cleanSymbol = cleanSymbol.split(":").pop()!;
  if (cleanSymbol === "P911") cleanSymbol = "P911.DE";

  let yahooInterval: "1d" | "1wk" | "1mo" = "1d";
  let finalIntervalLabel = "1D";

  if (requestedInterval === "1w" || requestedInterval === "w" || requestedInterval === "1wk") {
    yahooInterval = "1wk";
    finalIntervalLabel = "1W";
  } else if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  }

  await ctx.reply(`⏳ Lade 10-Jahres-Historie (${finalIntervalLabel}) für ${cleanSymbol}...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    // FIX: 10 Jahre Lookback. Damit ist der Makro-Boden von Anfang 2023 bei MSTR garantiert im Speicher!
    period1.setFullYear(period2.getFullYear() - 10); 

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

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Rolle und Ziel:
Du bist ein rigoroser Mathematiker und technischer Analyst für das Elliott-Wellen-Prinzip. Analysiere die Kursdaten im JSON-Format.

Daten-Array:
${dataInputJson}

I. Fundamentale Struktur
Der Markt bewegt sich fraktal in 5 Wellen in Richtung des Trends und in 3 Wellen dagegen.

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE:
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem Muster. Der erste Punkt MUSS der absolute Startpunkt der Zählung sein (Welle 0 oder Start):

| Welle | Datum | Preis |
| --- | --- | --- |
| 0 | YYYY-MM-DD | 100.00 |
| 1 | YYYY-MM-DD | 120.00 |
| 2 | YYYY-MM-DD | 105.00 |

Nutze als Bezeichnungen NUR: 0, 1, 2, 3, 4, 5, A, B, C, I, II, III, IV, V.`;

  let responseText = "";
  let attempts = 3; 

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
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const wavesData = parseWavesFromText(responseText);

  if (wavesData.length === 0) {
      return ctx.reply(`🚨 **PARSER-FALLE AKTIV:** Die KI hat keine auslesbare Tabelle geliefert.\n\nRoher Output:\n\`\`\`text\n${responseText.substring(0, 3800)}\n\`\`\``);
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
  pythonProcess.stderr.on("data", (chunk: Buffer) => telemetryJsonStr += chunk.toString());

  pythonProcess.stdin.write(jsonArg);
  pythonProcess.stdin.end();

  pythonProcess.on("close", async (code) => {
    if (isDebug && telemetryJsonStr) {
        await ctx.reply(`🩻 **PYTHON TELEMETRIE:**\n\`\`\`json\n${telemetryJsonStr.substring(0, 3800)}\n\`\`\``);
    }

    if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ **Zeichnen fehlgeschlagen!** Exit-Code: ${code}\nLog:\n${telemetryJsonStr}`);
    } else {
        await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 TradingView Macro: ${cleanSymbol} (${finalIntervalLabel})` });
    }
    await ctx.reply(responseText.substring(0, 4000));
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
