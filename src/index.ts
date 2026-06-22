import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

console.log("🤖 Bot v35: Single-Shot Downsampling Mode aktiv.");

// PARSER: Liest das JSON-Array der KI
function parseWavesFromJson(text: string) {
  try {
    const jsonStr = text.match(/\[.*\]/s)?.[0] || text;
    return JSON.parse(jsonStr);
  } catch (e) { return null; }
}

bot.command("analyse", async (ctx) => {
  const symbol = ctx.message.text.split(" ")[1]?.toUpperCase();
  if (!symbol) return ctx.reply("❌ Symbol?");

  await ctx.reply(`⏳ Daten-Downsampling für ${symbol}...`);

  try {
    const res = await yahooFinance.historical(symbol, { period1: "2020-01-01", period2: new Date(), interval: "1wk" });
    const candles = res.map(c => ({
        date: c.date.toISOString().split('T')[0],
        high: Number(c.high).toFixed(2),
        low: Number(c.low).toFixed(2)
    }));

    const stream = candles.map(c => `${c.date},${c.high},${c.low}`).join("|");

    await ctx.reply("🧠 Analysiere...");

    const prompt = `
Du bist ein EW-Analyst. Analysiere diesen Kurs-Stream (Letzte 5 Jahre):
${stream}

Markiere die Wellen I, II, III, IV, V und deren Unterwellen (1,2,3,4,5).
GIB AUSSCHLIESSLICH JSON ZURÜCK: 
[{"label": "1", "date": "YYYY-MM-DD", "price": 0.00}, ...]
    `;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { maxOutputTokens: 2048 }
    });

    const waves = parseWavesFromJson(response.text || "");
    if (!waves) return ctx.reply("❌ KI-Antwort kein JSON.");

    // Python-Kritiker rufen
    const py = await new Promise<any>((resolve) => {
        const p = spawn("python3", ["python_service/drawer.py"]);
        let out = Buffer.alloc(0), err = "";
        p.stdout.on("data", c => out = Buffer.concat([out, c]));
        p.stderr.on("data", c => err += c);
        p.stdin.write(JSON.stringify({ symbol, waves, candles }));
        p.stdin.end();
        p.on("close", () => resolve({ out, err }));
    });

    if (py.out.length > 0) {
        await ctx.replyWithPhoto({ source: py.out }, { caption: `📊 EW Analyse: ${symbol}` });
    } else {
        await ctx.reply(`❌ Python-Veto: ${py.err}`);
    }

  } catch (e: any) { ctx.reply(`❌ Fehler: ${e.message}`); }
});

bot.launch();
