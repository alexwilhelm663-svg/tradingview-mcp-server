import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Multimodaler Bot läuft. Ultrastrenge EW-Regeln aktiv...");

bot.catch((err, ctx) => {
  console.error(`⚠️ Globaler Telegraf-Fehler für Update-Typ ${ctx.updateType}:`, err);
  ctx.reply("❌ Interner Timeout. Der Server war überlastet, bitte versuche es noch einmal.").catch(() => {});
});

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345a-cA-CWXYIViv]+):\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    let rawLabel = match[1].trim();
    if (["i","ii","iii","iv","v","w","x","y"].includes(rawLabel.toLowerCase())) {
        rawLabel = rawLabel.toUpperCase();
    }
    waves.push({
      label: rawLabel,
      date: match[2].trim()
    });
  }
  return waves;
}

bot.on("photo", async (ctx) => {
  const caption = ctx.message.caption || "";
  
  if (!caption.toLowerCase().startsWith("/analyse")) {
    return ctx.reply("❌ Bitte füge dem Bild als Unterschrift den Analyse-Befehl hinzu. Beispiel: /analyse TEAM 1W");
  }

  const chatId = ctx.chat.id;
  const args = caption.split(" ");
  let symbol = args[1];
  let requestedInterval = args[2] ? args[2].toLowerCase().trim() : "auto";
  
  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol in der Unterschrift an! Beispiel: /analyse TEAM 1W");
  }

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }
  if (cleanSymbol === "P911") {
    cleanSymbol = "P911.DE";
  }

  let yahooInterval = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  } else if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  } else if (requestedInterval === "1h" || requestedInterval === "h") {
    yahooInterval = "1h";
    finalIntervalLabel = "1H";
  }

  await ctx.reply(`🖼️ Bild empfangen. Lade native ${finalIntervalLabel}-Historie für ${cleanSymbol} von Yahoo...`);

  let candlesArray: Array<{ date: string; open: string; high: string; low: string; close: string }> = [];
  let base64Image = "";

  try {
    const period2 = Math.floor(Date.now() / 1000);
    const lookbackDays = finalIntervalLabel === "1H" ? 30 : (10 * 365); 
    const period1 = period2 - (lookbackDays * 24 * 60 * 60);

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?period1=${period1}&period2=${period2}&interval=${yahooInterval}&events=history`;
    
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const resData: any = await response.json();
    const result = resData?.chart?.result?.[0];
    
    if (!result || !result.timestamp) throw new Error("Symbol an der API nicht verfügbar.");

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const rawHistorical = timestamps.map((ts: number, i: number) => {
      const d = new Date(ts * 1000);
      const dateStr = finalIntervalLabel === "1H" ? d.toISOString().replace('T', ' ').substring(0, 16) : d.toISOString().split('T')[0];
      
      const o = Number(quote.open[i]);
      const h = Number(quote.high[i]);
      const l = Number(quote.low[i]);
      const c = Number(quote.close[i]);

      return {
        date: dateStr, open: o.toFixed(2), high: h.toFixed(2), low: l.toFixed(2), close: c.toFixed(2)
      };
    }).filter((c: any) => Number(c.open) > 0 && Number(c.high) > 0 && Number(c.low) > 0 && Number(c.close) > 0);

    let lookback = 150;
    if (finalIntervalLabel === "1W") {
      lookback = 500; 
    } else if (finalIntervalLabel === "1D") {
      lookback = 400; 
    } else if (finalIntervalLabel === "1M") {
      lookback = 240; 
    } else if (finalIntervalLabel === "1H") {
      lookback = 200;
    }
    
    candlesArray = rawHistorical.slice(-lookback);

    await ctx.reply("👁️ Verarbeite TradingView-Screenshot für die multimodale Analyse...");
    const highestResPhoto = ctx.message.photo[ctx.message.photo.length - 1]; 
    const fileLink = await ctx.telegram.getFileLink(highestResPhoto.file_id);
    const imageResponse = await fetch(fileLink.href);
    const imageBuffer = await imageResponse.arrayBuffer();
    base64Image = Buffer.from(imageBuffer).toString("base64");

  } catch (err: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Daten- oder Bildfehler: ${err.message}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  // ULTRARIEGEL-PROMPT: Verbietet Faulheit und Abkürzungen
  const mainPrompt = `Du bist ein strenger mathematischer Analyst für Elliott-Wellen. Analysiere das übermittelte Bild (TradingView Chart) UND das JSON-Array.
  
Daten-Array (Referenz für exakte Timestamps/Preise):
${dataInputJson}

Aufgabe & Strikte Regeln (DULDET KEINE ABWEICHUNG):
1. Analysiere den gesamten Chart. Das absolute Allzeithoch im Bild MUSS zwingend die Makro-Welle V (5) sein.
2. DU DARFST NICHT ABKÜRZEN. Du MUSST zwingend den kompletten Makro-Zyklus (I, II, III, IV, V, A, B, C) finden.
3. AKRIBISCHE SUB-STRUKTUR REGEL: Es sollen **alle** Subwellen eingezeichnet werden. Das ist ein Befehl. Du **MUSST** zwingend für JEDE Makro-Impulswelle (I, III, V) die vollen 5 Unterwellen (1, 2, 3, 4, 5) identifizieren. Du **MUSST** zwingend für JEDE Makro-Korrekturwelle (II, IV, A, C) die vollen 3 Unterwellen (a, b, c) identifizieren.
4. Versage nicht bei der mathematischen Genauigkeit. Wenn du eine Sub-Welle 3 nennst, suche im JSON nach dem exakten Preishoch dieser Kerze.
5. Verknüpfe die visuellen Wendepunkte aus dem Bild mit den exakten Kerzen im JSON-Array.
6. Markiere JEDEN Wendepunkt im Text in diesem Format: [Welle III: 2026-04-24] oder [Welle 3: 2026-04-24] oder [Welle c: 2026-04-24].

WICHTIG ZUR UNTERSCHEIDUNG (STRENG EINHALTEN):
- Nutze RÖMISCHE Ziffern und GROSSBUCHSTABEN (I, II, III, IV, V, A, B, C) für die Haupt-Makrowellen.
- Nutze ARABISCHE Ziffern und KLEINBUCHSTABEN (1, 2, 3, 4, 5, a, b, c) für die internen Unterwellen.
Jedes spezifische Label darf nur EXAKT EINMAL markiert werden!`;

  let responseText = "";
  let attempts = 4; 
  let delay = 2000; 
  
  await ctx.reply(`🧠 Scanne akribisch den gesamten Chart nach JEDER Unterwelle...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          mainPrompt, 
          { inlineData: { data: base64Image, mimeType: "image/jpeg" } } 
        ],
        config: {
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });
      
      responseText = response.text || "";
      if (responseText) break;
      else throw new Error("Leere Struktur.");
    } catch (apiError: any) {
      attempts--;
      console.error(`⚠️ API Fehler: ${apiError.message}`);
      
      if (attempts === 0) {
        return ctx.reply(`❌ Systemfehler: Google blockiert die Anfrage endgültig.\n\nGrund: ${apiError.message}`);
      }
      
      await ctx.reply(`⚠️ API antwortet nicht sofort. Starte Versuch ${4 - attempts}... (Wartezeit: ${delay/1000}s)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay += 2000;
    }
  }

  try {
    const rawWaves = parseWavesFromText(responseText);
    
    const uniqueWavesMap = new Map<string, {label: string, date: string}>();
    rawWaves.forEach(w => {
      if (!uniqueWavesMap.has(w.label)) {
        uniqueWavesMap.set(w.label, w);
      }
    });
    
    const wavesData = Array.from(uniqueWavesMap.values());
    const analysisText = responseText;

    chatSessions[chatId] = {
      lastDataPayload: { candles: candlesArray, waves: wavesData },
      history: [{ role: "user", text: "Kursdaten und Bild analysiert." }, { role: "model", text: analysisText }]
    };

    await ctx.reply("🎨 Generiere Multi-Level Candlestick Chart mit ALLEN Subwellen...");

    const jsonArg = JSON.stringify({ waves: wavesData, candles: candlesArray });
    const pythonProcess = spawn("python3", ["python_service/drawer.py", jsonArg]);
    
    const stdoutChunks: Buffer[] = [];
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    pythonProcess.on("close", async (code) => {
      try {
        if (code !== 0 || stdoutChunks.length === 0) {
          await ctx.reply(`❌ Fehler beim Rendern des Vektordiagramms.`);
        } else {
          const outputBuffer = Buffer.concat(stdoutChunks);
          await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Akribische Struktur-Analyse: ${cleanSymbol} (${finalIntervalLabel})` });
        }
        
        const fullText = `📝 Struktur-Bericht:\n\n${analysisText}`;
        const maxLength = 4000;
        for (let i = 0; i < fullText.length; i += maxLength) {
          await ctx.reply(fullText.substring(i, i + maxLength));
        }

      } catch (innerErr: any) {
        console.error("Fehler beim Versand von Chart/Text:", innerErr);
        await ctx.reply(`❌ Fehler bei der Telegram-Ausgabe: ${innerErr.message}`);
      }
    });

  } catch (err: any) {
    await ctx.reply(`❌ Verarbeitungsfehler: ${err.message}`);
  }
});

bot.command("analyse", (ctx) => {
  ctx.reply("⚠️ Dieser Befehl benötigt jetzt ein Bild! Bitte lade einen TradingView-Screenshot hoch und nutze z.B. '/analyse TEAM 1W' als Bildunterschrift.");
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastDataPayload) {
    return ctx.reply("❌ Starte zuerst eine Analyse mit einem Bild und dem Befehl in der Unterschrift.");
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
      contents: contents,
      config: {
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
      }
    });

    const answerText = response.text || "Keine Antwort möglich.";
    session.history.push({ role: "model", text: answerText });
    await ctx.reply(`💬 Antwort:\n\n${answerText}`);
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
          res.writeHead(200);
          res.end();
          bot.handleUpdate(update).catch((err) => {
            console.error("❌ Webhook Update Fehler:", err);
          });
        } catch (e) {
          if (!res.headersSent) {
            res.writeHead(400);
            res.end("Bad Request");
          }
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
