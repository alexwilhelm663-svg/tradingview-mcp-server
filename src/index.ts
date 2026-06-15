import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft im robusten Regex-Text-Modus ohne Schema-Restriktionen...");

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

// Extremer robuster Regex-Parser, der Klammern und Textmüll ignoriert
function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345ABCWXY]+):\s*(\d{4}-\d{2}-\d{2})\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    waves.push({
      label: match[1].toUpperCase().trim(),
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

  await ctx.reply(`⏳ Extrahiere historische Daten für ${cleanSymbol} via Yahoo REST...`);

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
      throw new Error("Symbol an der API nicht verfügbar oder IP blockiert.");
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const rawHistorical = timestamps.map((ts: number, i: number) => {
      const d = new Date(ts * 1000);
      const o = Number(quote.open[i]);
      const h = Number(quote.high[i]);
      const l = Number(quote.low[i]);
      const c = Number(quote.close[i]);

      return {
        date: d.toISOString().split('T')[0],
        open: o,
        high: h,
        low: l,
        close: c
      };
    }).filter((c: any) => c.open > 0 && c.high > 0 && c.low > 0 && c.close > 0);

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
      }).slice(-75);

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
      }).slice(-75);

    } else {
      finalIntervalLabel = "1D";
      candlesArray = rawHistorical.slice(-75).map((c: any) => ({
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

  const dataInputJson = JSON.stringify(candlesArray);

  // Völlig freier Text-Prompt, schützt vor 400er Schema-Abstürzen.
  // Explizites Verbot römischer Ziffern, um den Logik-Fehler im Python-Drawer zu umgehen.
  const mainPrompt = `Du bist ein Mathematiker für fraktale Datenreihen. Analysiere das übermittelte JSON-Array auf zyklische Elliott-Wellen.
  
Daten-Array:
${dataInputJson}

Aufgabe:
1. Untersuche den Verlauf auf fraktale Kontraktion und anschließende Expansion (Fokus auf "Third of a Third" Setups).
2. Verfasse eine rein akademische Beschreibung der Wellenverhältnisse und Kursziele (1.618 Extension).
3. Markiere JEDEN wichtigen Wendepunkt im Text zwingend in diesem Format: [Welle 3: 2026-04-24].
WICHTIG: Nutze für alle Wellen und Unterwellen AUSSCHLIESSLICH arabische Ziffern oder Standard-Buchstaben (1, 2, 3, 4, 5, A, B, C, W, X, Y). Verwende absolut keine römischen Ziffern oder Klammern!`;

  let responseText = "";
  let attempts = 4; 
  let delay = 2000; 
  
  await ctx.reply(`🧠 Scanne Struktur auf ${finalIntervalLabel}-Basis nach Mustern...`);

  while (attempts > 0) {
    try {
      // Keinerlei Schema-Einschränkungen mehr, um API-Abbrüche zu verhindern
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt
      });
      
      responseText = response.text || "";
      if (responseText) break;
      else throw new Error("Leere Struktur.");
    } catch (apiError: any) {
      attempts--;
      console.error(`⚠️ API Fehler: ${apiError.message}`);
      if (attempts === 0) {
        return ctx.reply(`❌ Systemfehler: Google blockiert die Anfrage. Bitte versuche es in wenigen Minuten noch einmal.`);
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
      
      await ctx.reply(`📝 <b>Struktur-Bericht:</b>\n\n${convertToTelegramHTML(analysisText)}`, { parse_mode: "HTML" });
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
    console.log(`🌐 Webhook-Server aktiv auf Port ${PORT}.`);
  });
} else {
  console.log("⚠️ RENDER_EXTERNAL_URL fehlt. Nutze Polling als Fallback...");
  bot.launch();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
      
