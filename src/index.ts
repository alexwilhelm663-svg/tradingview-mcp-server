import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const FMP_API_KEY = process.env.FMP_API_KEY;

console.log("🤖 Bot läuft im mathematischen FMP-Aggregationsmodus...");

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

// Hilfsfunktion: Ermittelt die Kalenderwoche für die Aggregation
function getWeekNumber(dateStr: string): string {
  const d = new Date(dateStr);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); // Korrigiert: Date.UTC statt Date.utc
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${weekNo}`;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(" ");
  let symbol = args[1];
  const rawInterval = (args[2] || "1D").toLowerCase().trim();
  
  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse TEAM 1w");
  }

  if (!FMP_API_KEY) {
    return ctx.reply("❌ Systemfehler: FMP_API_KEY fehlt in den Render-Umgebungsvariablen.");
  }

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }

  if (cleanSymbol === "P911") {
    cleanSymbol = "P911.DE";
  }

  await ctx.reply(`⏳ Rufe Kursdaten für ${cleanSymbol} über FMP API ab...`);

  let candlesArray: Array<{ date: string; high: string; low: string; close: string }> = [];
  try {
    // Wir holen IMMER die täglichen Daten (stabilster Endpoint bei FMP)
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${cleanSymbol}?apikey=${FMP_API_KEY}`;
    const response = await fetch(url);
    const resData: any = await response.json();

    if (!resData.historical || resData.historical.length === 0) {
      throw new Error("Symbol nicht gefunden oder API-Limit erreicht.");
    }

    // Holen uns genug Historie (z.B. die letzten 220 Tage), um Wochen/Monate zu bauen
    const rawHistorical = resData.historical.slice(0, 220).reverse();

    if (rawInterval === "1w" || rawInterval === "w") {
      // MATHEMATISCHE WOCHEN-AGGREGATION
      const groups: Record<string, any[]> = {};
      rawHistorical.forEach((c: any) => {
        const wKey = getWeekNumber(c.date);
        if (!groups[wKey]) groups[wKey] = [];
        groups[wKey].push(c);
      });

      const wKeys = Object.keys(groups).sort();
      candlesArray = wKeys.map(k => {
        const candles = groups[k];
        const highs = candles.map(c => Number(c.high));
        const lows = candles.map(c => Number(c.low));
        return {
          date: candles[candles.length - 1].date, // Letztes Datum der Woche
          high: Math.max(...highs).toFixed(2),
          low: Math.min(...lows).toFixed(2),
          close: Number(candles[candles.length - 1].close).toFixed(2)
        };
      }).slice(-45); // Begrenzen auf 45 Kerzen für optimalen Gemini-Context

    } else if (rawInterval === "1m" || rawInterval === "m" || rawInterval === "mo") {
      // MATHEMATISCHE MONATS-AGGREGATION
      const groups: Record<string, any[]> = {};
      rawHistorical.forEach((c: any) => {
        const mKey = c.date.substring(0, 7); // YYYY-MM
        if (!groups[mKey]) groups[mKey] = [];
        groups[mKey].push(c);
      });

      const mKeys = Object.keys(groups).sort();
      candlesArray = mKeys.map(k => {
        const candles = groups[k];
        const highs = candles.map(c => Number(c.high));
        const lows = candles.map(c => Number(c.low));
        return {
          date: candles[candles.length - 1].date,
          high: Math.max(...highs).toFixed(2),
          low: Math.min(...lows).toFixed(2),
          close: Number(candles[candles.length - 1].close).toFixed(2)
        };
      }).slice(-45);

    } else {
      // STANDARD: 1 TAG (Reine Weiterleitung)
      const slice = resData.historical.slice(0, 45).reverse();
      candlesArray = slice.map((c: any) => ({
        date: c.date,
        high: Number(c.high).toFixed(2),
        low: Number(c.low).toFixed(2),
        close: Number(c.close).toFixed(2)
      }));
    }

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Kursdatenfehler: ${dataError.message}`);
  }

  await ctx.reply(`🧠 Berechne Elliott-Wellen-Muster (${rawInterval.toUpperCase()}) via Gemini...`);

  const formattedDataText = candlesArray.map(c => `Date: ${c.date} -> H: ${c.high}, L: ${c.low}, C: ${c.close}`).join("\n");

  const jsonPrompt = `Du bist ein präziser Elliott-Wellen-Analyst. Vor dir liegen die historischen Kursdaten eines Assets:
${formattedDataText}

Aufgabe:
1. Analysiere den mathematischen Kursverlauf.
2. Identifiziere die signifikanten Hochs und Tiefs.
3. Ordne diesen exakten Datenpunkten (referenziert über das 'date') die korrekten Wellen-Labels zu (1-5, A-C oder W-X-Y).
4. Schreibe im Feld 'analysis_text' eine professionelle Begründung des Musters nach Prechter-Regeln sowie Kursziele.

Antworte AUSSCHLIESSLICH im geforderten JSON-Schema.`;

  try {
    let responseText = "";
    let attempts = 5; 
    let delay = 3000; 
    
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
                      label: { type: Type.STRING, description: "Wellenbezeichnung z.B. 1, 2, A, B, C" },
                      date: { type: Type.STRING, description: "Das EXAKTE Datum des Kursdatenpunkts, an dem die Welle dreht." }
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
        break; 
      } catch (apiError: any) {
        attempts--;
        console.warn(`⚠️ Gemini API überlastet. Versuche verbleibend: ${attempts}.`);
        if (attempts === 0) throw apiError;
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
      }
    }

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

    await ctx.reply("🎨 Generiere mathematischen Vektor-Chart...");

    const jsonArg = JSON.stringify({ waves: wavesData, candles: candlesArray });
    const pythonProcess = spawn("python3", ["python_service/drawer.py", jsonArg]);
    
    const stdoutChunks: Buffer[] = [];
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));

    pythonProcess.on("close", async (code) => {
      if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ Fehler beim Rendern des Vektordiagramms.`);
      } else {
        const outputBuffer = Buffer.concat(stdoutChunks);
        await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Struktur-Analyse: ${cleanSymbol} (${rawInterval.toUpperCase()})` });
      }
      await ctx.reply(`📝 <b>Elliott-Wellen-Analyse:</b>\n\n${convertToTelegramHTML(analysisText)}`, { parse_mode: "HTML" });
    });

  } catch (err: any) {
    await ctx.reply(`❌ Fehler bei der Verarbeitung: ${err.message}`);
  }
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastDataPayload) {
    return ctx.reply("❌ Starte zuerst eine Analyse mit `/analyse`.");
  }

  await ctx.reply("🤔 Analysiere deine Rückfrage...");

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

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
