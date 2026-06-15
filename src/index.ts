import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const TD_API_KEY = process.env.TWELVE_DATA_API_KEY;

console.log("🤖 Streng mathematischer Bot läuft ohne Browser-Overhead...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseIntervalForTD(input: string): string {
  const clean = input.toLowerCase().trim();
  if (clean === "1m" || clean === "m" || clean === "mo") return "1month";
  if (clean === "1w" || clean === "w") return "1week";
  if (clean === "1d" || clean === "d") return "1day";
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
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse TEAM 1w");
  }

  if (!TD_API_KEY) {
    return ctx.reply("❌ Systemfehler: TWELVE_DATA_API_KEY fehlt.");
  }

  let cleanSymbol = symbol.trim();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }

  const tdInterval = parseIntervalForTD(rawInterval);
  await ctx.reply(`⏳ Rufe Kursdaten für ${cleanSymbol} ab...`);

  let candlesArray: Array<{ date: string; high: string; low: string; close: string }> = [];
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${cleanSymbol}&interval=${tdInterval}&outputsize=45&apikey=${TD_API_KEY}`;
    const response = await fetch(url);
    const resData: any = await response.json();

    if (resData.status === "error" || !resData.values) {
      throw new Error(resData.message || "Fehler beim API-Abruf.");
    }

    const values = resData.values.reverse();
    candlesArray = values.map((c: any) => ({
      date: c.datetime.split(" ")[0],
      high: Number(c.high).toFixed(2),
      low: Number(c.low).toFixed(2),
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

    let cleanJson = (response.text || "").trim();
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
