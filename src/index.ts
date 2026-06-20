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

console.log("🤖 Bot läuft in der Cloud mit dynamischem Chart-Crop-System...");

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
        if (!priceMatch) continue;
        const price = parseFloat(priceMatch[0].replace(',', '.'));
        
        if (label.length > 0 && rawDate.length >= 4 && !isNaN(price)) {
            waves.push({ label, date: rawDate, price });
        }
    }
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

  let yahooInterval: "1d" | "1wk" | "1mo" = "1d";
  let finalIntervalLabel = "1D";

  if (requestedInterval === "1w" || requestedInterval === "w" || requestedInterval === "1wk") {
    yahooInterval = "1wk";
    finalIntervalLabel = "1W";
  } else if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  }

  await ctx.reply(`⏳ Lade komplette ${finalIntervalLabel}-Historie für ${cleanSymbol}...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setFullYear(period2.getFullYear() - 3); 

    const result = await yahooFinance.historical(cleanSymbol, {
      period1: period1,
      period2: period2,
      interval: yahooInterval
    }) as any[];

    if (!result || result.length === 0) {
      throw new Error("Keine Daten für dieses Symbol gefunden.");
    }

    candlesArray = result.map((c: any) => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(2),
      high: Number(c.high).toFixed(2),
      low: Number(c.low).toFixed(2),
      close: Number(c.close).toFixed(2)
    })).filter((c: any) => Number(c.open) > 0);

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Datenfehler: ${dataError.message}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Rolle und Ziel:
Du bist ein rigoroser Mathematiker und technischer Analyst für das Elliott-Wellen-Prinzip. Analysiere die Kursdaten im JSON-Format.

Daten-Array:
${dataInputJson}

I. Fundamentale Struktur
Der Markt bewegt sich fraktal in 5 Wellen in Richtung des Trends und in 3 Wellen dagegen.

II. Absolute Regeln für Motiv-Wellen
1. Welle 2 korrigiert nie >100% von Welle 1.
2. Welle 4 korrigiert nie >100% von Welle 3.
3. Welle 3 geht über das Ende von Welle 1 hinaus.
4. Welle 3 ist niemals die kürzeste Welle.
5. Kein Overlap zwischen Welle 4 und 1.

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE (ZWINGEND EINHALTEN!):
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem Muster. Der erste Punkt MUSS der absolute Startpunkt (Welle 0 oder Start) sein:

| Welle | Datum | Preis |
| --- | --- | --- |
| 0 | YYYY-MM-DD | 100.00 |
| 1 | YYYY-MM-DD | 120.00 |
| 2 | YYYY-MM-DD | 105.00 |

Nutze als Bezeichnungen NUR: 0, 1, 2, 3, 4, 5, A, B, C, I, II, III, IV, V.`;

  let responseText = "";
  let attempts = 4; 
  let delay = 2000; 
  
  await ctx.reply(`🧠 Scanne Struktur nach Mustern...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
        config: {
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });
      
      responseText = response.text || "";
      if (responseText) break;
    } catch (apiError: any) {
      attempts--;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay += 2000;
    }
  }

  try {
    const wavesData = parseWavesFromText(responseText);
    if (wavesData.length === 0) {
      return ctx.reply("❌ Keine gültige Wellen-Tabelle gefunden.");
    }

    chatSessions[chatId] = {
      lastDataPayload: { candles: candlesArray, waves: wavesData },
      history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: responseText }]
    };

    await ctx.reply("🎨 Generiere fokussierten Chart ab Welle 0...");

    const jsonArg = JSON.stringify({ symbol: cleanSymbol, waves: wavesData, candles: candlesArray });
    
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
    
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    pythonProcess.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    pythonProcess.stdin.write(jsonArg);
    pythonProcess.stdin.end();

    pythonProcess.on("close", async (code) => {
      try {
        if (code !== 0 || stdoutChunks.length === 0) {
          const errorLog = Buffer.concat(stderrChunks).toString().trim();
          await ctx.reply(`❌ Fehler beim Zeichnen: ${errorLog}`);
        } else {
          await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 TradingView: ${cleanSymbol} (${finalIntervalLabel})` });
        }
        await ctx.reply(`📝 Struktur-Bericht:\n\n${responseText}`.substring(0, 4000));
      } catch (innerErr: any) {
        await ctx.reply(`❌ Ausgabe-Fehler: ${innerErr.message}`);
      }
    });

  } catch (err: any) {
    await ctx.reply(`❌ Fehler: ${err.message}`);
  }
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => bot.handleUpdate(JSON.parse(body)));
    } else res.end("OK");
  }).listen(PORT);
} else {
  bot.launch();
}
