import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Bot läuft im Third-of-Third Kriterien- & Auto-Timeframe-Modus...");

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
    const period1 = period2 - (3 * 365 * 24 * 60 * 60); // Erhöht auf 3 Jahre für Makro-Analysen

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

    // --- AUTOMATISCHE ODER MANUELLE INTERVALL-LOGIK ---
    // Wenn "auto" gewählt ist, nutzen wir den Wochenchart (1w), um das "Third of a Third" Setup im Makro-Bild zu scannen.
    if (requestedInterval === "1w" || requestedInterval === "w" || requestedInterval === "auto") {
      finalIntervalLabel = "1W";
      const groups: Record<string, any[]> = {};
      rawHistorical.forEach((c: any) => {
        const wKey = getWeekNumber(c.date);
        if (!groups[wKey]) groups[wKey] = [];
        groups[wKey].push(c);
      });

      const wKeys = Object.keys(groups).sort();
      // Erhöht auf die letzten 120 Kerzen, um ausgeprägte Wellenstrukturen sichtbar zu machen
      candlesArray = wKeys.map(k => {
        const candles = groups[k];
        return {
          date: candles[candles.length - 1].date,
          open: Number(candles[0].open).toFixed(2),
          high: Math.max(...candles.map(c => c.high)).toFixed(2),
          low: Math.min(...candles.map(c => c.low)).toFixed(2),
          close: Number(candles[candles.length - 1].close).toFixed(2)
        };
      }).slice(-120); 

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
      }).slice(-120);

    } else {
      finalIntervalLabel = "1D";
      candlesArray = rawHistorical.slice(-130).map((c: any) => ({
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

  // --- ANPASSUNG DES PROMPTS AUF "THIRD OF A THIRD" SETUPS ---
  const jsonPrompt = `Du bist ein hochkarätiger Elliott-Wellen-Analyst, der sich auf das Aufspüren von hochexplosiven "Third of a Third" (Welle 3 einer untergeordneten Welle 3) Setups spezialisiert hat.
Vor dir liegen die historischen Kursdaten (ca. 120 bis 130 Kerzen):
${formattedDataText}

Aufgabe:
1. Untersuche den übergeordneten Trend. Scanne die Daten darauf, ob eine große Korrektur (Welle 2 oder Welle B) gerade beendet wurde oder kurz vor dem Abschluss steht.
2. Suche explizit nach Anzeichen, dass der Kurs sich im Nestbau befindet (Welle 1 fertig, Welle 2 korrigiert; gefolgt von einer inneren Welle (i) und (ii)).
3. Ordne den exakten Drehpunkten (über das 'date') die passenden Wellen-Labels zu.
4. Analysiere im Feld 'analysis_text', ob hier ein echtes "Third of a Third"-Szenario vorliegt. Falls ja, hebe es hervor, berechne das 161.8% Fibonacci-Erweiterungsziel und beschreibe das ungültige Niveau (Invalidation Level).

Antworte AUSSCHLIESSLICH im geforderten JSON-Schema.`;

  let responseText = "";
  let attempts = 5; 
  let delay = 3000; 
  
  await ctx.reply(`🧠 Scanne Struktur auf ${finalIntervalLabel}-Basis nach Third-of-Third Patterns...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: jsonPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              analysis_text: { type: Type.STRING },
              waves: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING, description: "Wellenbezeichnung z.B. 1, 2, 3, 4, 5, A, B, C, (i), (ii)" },
                    date: { type: Type.STRING, description: "Das EXAKTE Datum des Kursdatenpunkts." }
                  },
                  required: ["label", "date"]
                }
              }
            },
            required: ["analysis_text", "waves"]
          }
        }
      });
      
      responseText = response.text || "";
      if (responseText) break;
      else throw new Error("Leere Antwort.");
    } catch (apiError: any) {
      attempts--;
      if (attempts === 0) {
        return ctx.reply(`❌ API überlastet. Bitte versuche es erneut.`);
      }
      await ctx.reply(`⏳ API ausgelastet, neuer Versuch in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }

  try {
    let cleanJson = responseText.trim();
    if (cleanJson.startsWith("```")) {
      cleanJson = cleanJson.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
    }

    const result = JSON.parse(cleanJson);
    const wavesData = result.waves || [];
    const analysisText = result.analysis_text || "Keine Analyse generiert.";

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

bot.launch();

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Bot is alive");
});
server.listen(PORT, () => {
  console.log(`🌐 Dummy HTTP-Server läuft auf Port ${PORT}`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
