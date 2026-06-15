import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const FMP_API_KEY = process.env.FMP_API_KEY;

console.log("🤖 Bot läuft im kostenlosen FMP-Datenmodus...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseIntervalForFMP(input: string): string {
  const clean = input.toLowerCase().trim();
  if (clean === "1m" || clean === "m" || clean === "mo") return "1month";
  if (clean === "1w" || clean === "w") return "1week";
  return "1day";
}

function convertToTelegramHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.*?)\*/g, "<i>$1</i>")
    .replace(/`(.*?)`/g, "<code>$1</code>");
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(" ");
  let symbol = args[1];
  const rawInterval = args[2] || "1D";
  
  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse P911 1w");
  }

  if (!FMP_API_KEY) {
    return ctx.reply("❌ Systemfehler: FMP_API_KEY fehlt in den Render-Umgebungsvariablen.");
  }

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }

  // Automatisches Suffix für deutsche Aktien (z.B. P911 -> P911.DE)
  if (cleanSymbol === "P911") {
    cleanSymbol = "P911.DE";
  }

  const fmpInterval = parseIntervalForFMP(rawInterval);
  await ctx.reply(`⏳ Rufe kostenlose Kursdaten für ${cleanSymbol} über FMP API ab...`);

  let candlesArray: Array<{ date: string; high: string; low: string; close: string }> = [];
  try {
    let url = `https://financialmodelingprep.com/api/v3/historical-price-full/${cleanSymbol}?apikey=${FMP_API_KEY}`;
    
    // Wenn wöchentlich oder monatlich gefordert, nutzen wir die spezifische FMP-Schnittstelle
    if (fmpInterval !== "1day") {
      url = `https://financialmodelingprep.com/api/v3/historical-price-full/${cleanSymbol}?timeseries=45&serietype=line&apikey=${FMP_API_KEY}`;
    }

    const response = await fetch(url);
    const resData: any = await response.json();

    if (!resData.historical || resData.historical.length === 0) {
      throw new Error("Symbol nicht gefunden oder API-Limit erreicht.");
    }

    // Die neuesten 45 Kerzen extrahieren und chronologisch umdrehen
    const slice = resData.historical.slice(0, 45).reverse();
    candlesArray = slice.map((c: any) => ({
      date: c.date,
      high: Number(c.high || c.close).toFixed(2),
      low: Number(c.low || c.close).toFixed(2),
      close: Number(c.close).toFixed(2)
    }));

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Kursdatenfehler: ${dataError.message}`);
  }

  await ctx.reply("🧠 Berechne Elliott-Wellen-Muster via Gemini...");

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
        await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Struktur-Analyse: ${cleanSymbol} (${rawInterval})` });
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

