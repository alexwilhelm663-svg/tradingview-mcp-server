import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Bombenfeste Telegraf-Konfiguration (schaltet das 90s-Timeout ab)
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft im Webhosting-Modus mit Yahoo-Anti-Bot-Bypass und stdin-Pipeline...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345ABCWXYIV]+):\s*(\d{4}-\d{2}-\d{2})\]/gi;
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

  let yahooInterval = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  } else if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  }

  await ctx.reply(`⏳ Lade komplette ${finalIntervalLabel}-Historie für ${cleanSymbol} von Yahoo (Browser-Tarnung aktiv)...`);

  let candlesArray: Array<{ date: string; open: string; high: string; low: string; close: string }> = [];

  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (3 * 365 * 24 * 60 * 60); // 3 Jahre Historie

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cleanSymbol}?period1=${period1}&period2=${period2}&interval=${yahooInterval}&events=history`;
    
    // --- DER YAHOO ANTI-BOT BYPASS ---
    // Tarnt die Render-Server-Anfrage als normalen Chrome-Browser auf einem Windows-PC
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });

    const resData: any = await response.json();
    const result = resData?.chart?.result?.[0];
    
    if (!result || !result.timestamp) {
      throw new Error("Symbol an der API nicht verfügbar.");
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
        open: o.toFixed(2),
        high: h.toFixed(2),
        low: l.toFixed(2),
        close: c.toFixed(2)
      };
    }).filter((c: any) => Number(c.open) > 0 && Number(c.high) > 0 && Number(c.low) > 0 && Number(c.close) > 0);

    // Alle Daten übernehmen, kein Abschneiden mehr!
    candlesArray = rawHistorical;

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Datenfehler: ${dataError.message}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Du bist ein rigoroser Mathematiker und Experte für fraktale Datenreihen. Analysiere das übermittelte JSON-Array mit historischen Kursdaten auf zyklische Elliott-Wellen-Muster.
  
Daten-Array:
${dataInputJson}

DEINE AUFGABE UND ANALYSE-REGELN:
1. Untersuche den Verlauf auf fraktale Kontraktion und anschließende Expansion. Suche gezielt nach "Third of a Third" Setups (Welle III von 3).
2. Verfasse eine rein akademische Beschreibung der Wellenstruktur, Fibonacci-Verhältnisse und Kursziele (z. B. 1.618 Extension).

ABSOLUTE GESETZE DER WELLEN-STRUKTUR (Diese dürfen NIEMALS gebrochen werden):
- Welle 2 darf Welle 1 niemals zu 100% oder mehr korrigieren (sie darf nicht unter den Startpunkt von Welle 1 fallen).
- Welle 3 darf niemals die kürzeste der drei Antriebswellen (1, 3 und 5) sein.
- Welle 4 darf niemals in das Preisgebiet von Welle 1 eindringen (kein Overlap, außer in seltenen Diagonal Triangles am Ende eines Trends).
- Korrekturwellen bestehen niemals aus 5 Sub-Wellen, sondern aus 3 (A-B-C) oder deren Kombinationen (W-X-Y).

MATHEMATISCHE RICHTLINIEN & FIBONACCI:
- Guideline of Alternation: Wenn Welle 2 eine scharfe, steile Korrektur (Zigzag) ist, erwarte, dass Welle 4 eine flache Seitwärtskorrektur (Flat/Triangle) wird - und umgekehrt.
- Extensionen: Meistens ist Welle 3 verlängert. Wenn Welle 3 die Extension ist, streben Welle 1 und Welle 5 in Länge und Zeit nach Gleichheit oder einem 0.618-Verhältnis.
- Fibonacci-Ziele: Das typische Ziel für eine reguläre Welle 3 ist das 1.618-fache der Länge von Welle 1, angelegt an das Ende von Welle 2.

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE:
- Markiere JEDEN wichtigen Wendepunkt (Top/Bottom der Kerze) zwingend exakt in diesem Regex-Format irgendwo im Text: [Welle 3: YYYY-MM-DD].
- Ersetze "3" durch das jeweilige Label und "YYYY-MM-DD" durch das exakte Datum aus dem JSON.
- WICHTIG: Nutze für alle Wellen und Unterwellen AUSSCHLIESSLICH diese Bezeichnungen: 1, 2, 3, 4, 5, A, B, C, W, X, Y, I, II, III, IV, V.
- Verwende absolut keine kleinen römischen Ziffern, keine Klammern um die Bezeichnungen und erfinde keine eigenen Labels!`;

  let responseText = "";
  let attempts = 4; 
  let delay = 2000; 
  
  await ctx.reply(`🧠 Scanne Struktur auf ${finalIntervalLabel}-Basis nach Mustern...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
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
        return ctx.reply(`❌ Systemfehler: Google blockiert die Anfrage.\n\nGrund: ${apiError.message}`);
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
    
    // Startet Python OHNE Kommandozeilenargumente
    const pythonProcess = spawn("python3", ["python_service/drawer.py"]);
    
    // Daten durch den unendlichen stdin-Stream pushen
    pythonProcess.stdin.write(jsonArg);
    pythonProcess.stdin.end();
    
    const stdoutChunks: Buffer[] = [];
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    pythonProcess.on("close", async (code) => {
      try {
        if (code !== 0 || stdoutChunks.length === 0) {
          await ctx.reply(`❌ Fehler beim Rendern des Vektordiagramms.`);
        } else {
          const outputBuffer = Buffer.concat(stdoutChunks);
          await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Struktur-Analyse: ${cleanSymbol} (${finalIntervalLabel})` });
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
          // Der Telegram Timeout-Killer
          res.writeHead(200);
          res.end();
          bot.handleUpdate(update);
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
