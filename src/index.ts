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

console.log("🤖 Bot läuft in der Cloud mit kausaler EW-Führung & Log-Scale Pipeline...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

// Kugelsicherer Parser: Prüft Spalte 1 auf Datums-Ziffern. Völlig immun gegen Text-Präfixe.
function parseWavesFromText(text: string): Array<{ label: string; date: string; price: number }> {
  const waves: Array<{ label: string; date: string; price: number }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
    
    // Gültige Zeile: Mindestens 2 Spalten UND die Datums-Spalte (Index 1) enthält Ziffern
    if (parts.length >= 2 && /\d/.test(parts[1])) {
        let label = parts[0].replace(/[\*\`\[\]]/g, '').trim();
        // Schneidet Präfixe weg, damit saubere Bezeichnungen (0, 1, III, A) bleiben
        label = label.replace(/^(?:Welle|Wave|Top|Bottom|Punkt|Pivot)\s+/i, '').trim();
        
        const rawDate = parts[1].replace(/[\*\`\[\]]/g, '').trim();
        
        let price = 0;
        if (parts.length >= 3) {
            const priceMatch = parts[2].match(/[-0-9.,]+/);
            if (priceMatch) price = parseFloat(priceMatch[0].replace(',', '.'));
        }
        
        if (label && rawDate) {
            waves.push({ label, date: rawDate, price });
        }
    }
  }

  return waves;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const rawText = ctx.message.text;
  const args = rawText.split(" ");
  
  const symbol = args[1];
  const isDebug = rawText.toLowerCase().includes("debug");
  
  let requestedInterval = "auto";
  if (args[2] && args[2].toLowerCase() !== "debug") {
      requestedInterval = args[2].toLowerCase().trim();
  }

  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse MSTR");

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) cleanSymbol = cleanSymbol.split(":").pop()!;
  if (cleanSymbol === "P911") cleanSymbol = "P911.DE";

  // FIX: Standardmäßig nutzen wir Wochenkerzen (1W), um das tägliche Rauschen für Makro-Zählungen zu eliminieren!
  let yahooInterval: "1d" | "1wk" | "1mo" = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  } else if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  }

  await ctx.reply(`⏳ Lade 10-Jahres-Historie (${finalIntervalLabel}) für ${cleanSymbol} (Kausale Pipeline)...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setFullYear(period2.getFullYear() - 10); 

    const result = await yahooFinance.historical(cleanSymbol, { period1, period2, interval: yahooInterval }) as any[];
    if (!result || result.length === 0) throw new Error("Yahoo lieferte ein leeres Array.");

    candlesArray = result.map(c => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(2),
      high: Number(c.high).toFixed(2),
      low: Number(c.low).toFixed(2),
      close: Number(c.close).toFixed(2)
    })).filter(c => Number(c.open) > 0);

  } catch (dataError: any) {
    return ctx.reply(`❌ Yahoo Datenfehler: ${dataError.message}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Rolle und Ziel:
Du bist ein erstklassiger technischer Analyst und Senior-Experte für das Elliott-Wellen-Prinzip (Senior-EW-Analyst). Analysiere die historischen Kursdaten im JSON-Format. Da Märkte wie MSTR exponentiell wachsen, wird deine Zählung auf einer logarithmischen Y-Achse dargestellt.

Daten-Array (${finalIntervalLabel}-Kerzen):
${dataInputJson}

I. Absolute mathematische Gesetze für Motiv-Wellen (Impulse 1-2-3-4-5):
1. Welle 2 korrigiert Welle 1 niemals um mehr als 100% (orthodoxes Tief Welle 2 >= Start Welle 0).
2. Welle 3 ist meist die längste und stärkste Impulswelle und übertrifft das Hoch von Welle 1 deutlich.
3. Welle 3 darf niemals die kürzeste Aktionswelle (1, 3, 5) sein.
4. EISERNE REGEL (Kein Overlap): Das orthodoxe Tief von Welle 4 darf NIEMALS in den Preisbereich von Welle 1 eindringen! Das Tief von Welle 4 muss zwingend strikt ÜBER dem Hoch von Welle 1 liegen.
5. Welle 5 übertrifft das Hoch von Welle 3.

II. Kausale Abfolge in der Zeit:
Die Wellen müssen sich kausal vorwärts bewegen: Datum(Welle 0) < Datum(Welle 1) < Datum(Welle 2) < Datum(Welle 3) < Datum(Welle 4) < Datum(Welle 5).

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE:
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem vollständigen Muster. Der allererste Punkt MUSS der absolute Startboden sein (Label: 0):

| Welle | Datum | Preis |
| --- | --- | --- |
| 0 | YYYY-MM-DD | 15.50 |
| 1 | YYYY-MM-DD | 180.00 |
| 2 | YYYY-MM-DD | 100.00 |
| 3 | YYYY-MM-DD | 1500.00 |
| 4 | YYYY-MM-DD | 1100.00 |
| 5 | YYYY-MM-DD | 1900.00 |

Nutze als Bezeichnungen ausschließlich: 0, 1, 2, 3, 4, 5, A, B, C. Keine Prosa in der Tabelle!`;

  let responseText = "";
  let attempts = 3; 

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
        config: { safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] }
      });
      responseText = response.text || "";
      if (responseText) break;
    } catch (e) {
      attempts--;
      if (attempts === 0) return ctx.reply("❌ Gemini API Timeout.");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const wavesData = parseWavesFromText(responseText);

  if (wavesData.length === 0) {
      return ctx.reply(`🚨 **PARSER-FEHLER:** Die KI hat keine auslesbare Tabelle geliefert.\n\nRoher Output:\n\`\`\`text\n${responseText.substring(0, 3800)}\n\`\`\``);
  }

  chatSessions[chatId] = {
    lastDataPayload: { candles: candlesArray, waves: wavesData },
    history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: responseText }]
  };

  const jsonArg = JSON.stringify({ symbol: cleanSymbol, waves: wavesData, candles: candlesArray });
  
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  const pythonProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
  
  const stdoutChunks: Buffer[] = [];
  let telemetryLog = "";

  pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  pythonProcess.stderr.on("data", (chunk: Buffer) => telemetryLog += chunk.toString());

  pythonProcess.stdin.write(jsonArg);
  pythonProcess.stdin.end();

  pythonProcess.on("close", async (code) => {
    // X-Ray Telemetrie nur ausgeben, wenn "debug" verlangt wurde oder der Prozess crasht
    if ((isDebug || code !== 0) && telemetryLog) {
        await ctx.reply(`🩻 **PYTHON KAUSAL-TELEMETRIE:**\n\`\`\`json\n${telemetryLog.substring(0, 3800)}\n\`\`\``);
    }

    if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ **Zeichnen fehlgeschlagen!** Exit-Code: ${code}`);
    } else {
        await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 TradingView Macro (Log-Scale): ${cleanSymbol} (${finalIntervalLabel})` });
    }
    await ctx.reply(responseText.substring(0, 4000));
  });
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
      config: { safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] }
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
        // Sofortiges Acknowledge an Telegram (0 Retries)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));

        try {
          if (body.trim()) {
            bot.handleUpdate(JSON.parse(body));
          }
        } catch (e: any) {
          console.error("⚠️ Webhook Fehler:", e.message);
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

  server.listen(PORT, () => console.log(`🌐 Webhook aktiv auf Port ${PORT}.`));
} else {
  bot.launch();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
