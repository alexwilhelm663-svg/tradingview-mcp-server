import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft im fehlerfreien Safety-Bypass-Modus...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function convertToTelegramHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
}

function getWeekNumber(dateStr: string): string {
  const d = new Date(dateStr);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345ABCWXYiIvcV()]+):\s*(\d{4}-\d{2}-\d{2})\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    waves.push({
      label: match[1].trim(),
      date: match[2].trim()
    });
  }
  return waves;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(" ");
  let symbol = args[1];
  let requestedInterval = args[2] ? args[2].toLowerCase().trim() : "auto";
  
  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse TEAM");
  }

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }
  if (cleanSymbol === "P911") {
    cleanSymbol = "P911.DE";
  }

  await ctx.reply(`⏳ Extrahiere 3-Jahres-Historie für ${cleanSymbol} via Yahoo REST...`);

  let candlesArray: Array<{ date: string; open: string; high: string; low: string; close: string }> = [];
  let finalIntervalLabel = "1W";

  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (3 * 365 * 24 * 60 * 60);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });

    const resData: any = await response.json();
    const result = resData?.chart?.result?.[0];
    
    if (!result || !result.timestamp) {
      throw new Error("Symbol existiert nicht oder Verbindung wurde blockiert.");
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const rawHistorical = timestamps.map((ts: number, i: number) => {
      const d = new Date(ts * 1000);
      return {
        date: d.toISOString().split('T')[0],
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i]
      };
    }).filter((c: any) => c.open !== null && c.high !== null && c.low !== null && c.close !== null);

    if (requestedInterval === "1w" || requestedInterval === "w" || requestedInterval === "auto") {
      finalIntervalLabel = "1W";
      const groups: Record<string, any[]> = {};
      rawHistorical.forEach((c: any) => {
        const wKey = getWeekNumber(c.date);
        if (!groups[wKey]) groups[wKey] = [];
        groups[wKey].push(c);
      });

      const wKeys = Object.keys(groups).sort();
      candlesArray = wKeys.map(k => {
        const candles = groups[k];
        return {
          date: candles[candles.length - 1].date,
          open: Number(candles[0].open).toFixed(2),
          high: Math.max(...candles.map(c => c.high)).toFixed(2),
          low: Math.min(...candles.map(c => c.low)).toFixed(2),
          close: Number(candles[candles.length - 1].close).toFixed(2)
        };
      }).slice(-90); // Kompakter Context

    } else if (requestedInterval === "1m" || requestedInterval === "m" || requestedInterval === "mo") {
      finalIntervalLabel = "1M";
      const groups: Record<string, any[]> = {};
      rawHistorical.forEach((c: any) => {
        const mKey = c.date.substring(0, 7);
        if (!groups[mKey]) groups[mKey] = [];
        groups[mKey].push(c);
      });

      const mKeys = Object.keys(groups).sort();
      candlesArray = mKeys.map(k => {
        const candles = groups[k];
        return {
          date: candles[candles.length - 1].date,
          open: Number(candles[0].open).toFixed(2),
          high: Math.max(...candles.map(c => c.high)).toFixed(2),
          low: Math.min(...candles.map(c => c.low)).toFixed(2),
          close: Number(candles[candles.length - 1].close).toFixed(2)
        };
      }).slice(-90);

    } else {
      finalIntervalLabel = "1D";
      candlesArray = rawHistorical.slice(-90).map((c: any) => ({
        date: c.date,
        open: Number(c.open).toFixed(2),
        high: Number(c.high).toFixed(2),
        low: Number(c.low).toFixed(2),
        close: Number(c.close).toFixed(2)
      }));
    }

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Datenfehler: ${dataError.message}`);
  }

  const formattedDataText = candlesArray.map(c => `Date: ${c.date} -> O: ${c.open}, H: ${c.high}, L: ${c.low}, C: ${c.close}`).join("\n");

  const textPrompt = `Du bist ein professioneller Elliott-Wellen-Analyst. Analysiere die Kursdaten auf strukturelle Muster, insbesondere im Hinblick auf ein potenzielles "Third of a Third" Setup (Beginn einer kraftvollen Welle 3 von 3).
Hier sind die historischen Kursdaten:
${formattedDataText}

Aufgabe:
1. Bestimme, ob eine signifikante Korrektur abgeschlossen wurde.
2. Identifiziere den strukturellen Nestbau (Welle 1, Welle 2 sowie die inneren Unterwellen (i) und (ii)).
3. Verfasse eine prägnante Analyse mit konkreten Zielen und dem Invalidation-Level.
4. FÜR DIE CHART-GENERIERUNG: Platziere im Text für jeden markanten Drehpunkt ein exaktes Tag im Format [Welle Bezeichnung: YYYY-MM-DD]. Beispiel: [Welle 3: 2026-04-24].
Nutze ausschließlich diese Bezeichnungen: 1, 2, 3, 4, 5, A, B, C, (i), (ii).`;

  let responseText = "";
  let attempts = 3; 
  let delay = 3000; 
  
  await ctx.reply(`🧠 Scanne Struktur auf ${finalIntervalLabel}-Basis nach Third-of-Third Patterns...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: textPrompt,
        config: {
          // DEAKTIVIERUNG DER INHALTSFILTER FÜR MATHEMATISCHE ANALYSEN
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });
      
      responseText = response.text || "";
      if (responseText) break;
      else throw new Error("Leere Antwort.");
    } catch (apiError: any) {
      attempts--;
      if (attempts === 0) {
        return ctx.reply(`❌ Kritischer API-Fehler: Die Verbindung zu Google wurde blockiert. Bitte passe den Prompt an oder versuche es erneut.`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay += 2000;
    }
  }

  try {
    const wavesData = parseWavesFromText(responseText);
    const analysisText = responseText;

    chatSessions[chatId] = {
      lastDataPayload: { candles: candlesArray, waves: wavesData },
      history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: analysisText }]
    };

    await ctx.reply("🎨 Generiere Candlestick Makro-Chart...");

    const jsonArg = JSON.stringify({ waves: wavesData, candles: candlesArray });
    const pythonProcess = spawn("python3", ["python_service/drawer.py", jsonArg]);
    
    const stdoutChunks: Buffer[] = [];
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    pythonProcess.on("close", async (code) => {
      if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ Fehler beim Rendern des Vektordiagramms.`);
      } else {
        const outputBuffer = Buffer.concat(stdoutChunks);
        await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Struktur-Analyse: ${cleanSymbol} (${finalIntervalLabel})` });
      }
      await ctx.reply(`📝 <b>Elliott-Wellen Setup-Bericht:</b>\n\n${convertToTelegramHTML(analysisText)}`, { parse_mode: "HTML" });
    });

  } catch (err: any) {
    await ctx.reply(`❌ Verarbeitungsfehler: ${err.message}`);
  }
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastDataPayload) {
    return ctx.reply("❌ Starte zuerst eine Analyse mit `/analyse`.");
  }

  await ctx.reply("🤔 Analysiere Rückfrage...");

  try {
    session.history.push({ role: "user", text: userQuestion });
    const contents: any[] = [];
    session.history.forEach(msg => {
      contents.push(`${msg.role === "user" ? "User" : "Model"}: ${msg.text}`);
    });
    contents.push(`Beziehe dich auf folgende Rohdaten: ${JSON.stringify(session.lastDataPayload.candles)}. Beantworte die Frage kurz.`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents
    });

    const answerText = response.text || "Keine Antwort möglich.";
    session.history.push({ role: "model", text: answerText });
    await ctx.reply(`💬 <b>Antwort:</b>\n\n${convertToTelegramHTML(answerText)}`, { parse_mode: "HTML" });
  } catch (error: any) {
    await ctx.reply(`❌ Fehler: ${error.message}`);
  }
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  
  const server = http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        try {
          const update = JSON.parse(body);
          bot.handleUpdate(update, res);
        } catch (e) {
          res.writeHead(400);
          res.end("Bad Request");
        }
      });
    } else if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Bot Server is healthy");
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Webhook-Server aktiv auf Port ${PORT}. Route: ${webhookPath}`);
  });
} else {
  console.log("⚠️ RENDER_EXTERNAL_URL fehlt. Nutze Polling als Fallback...");
  bot.launch();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
