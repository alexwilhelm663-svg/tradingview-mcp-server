import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";
import { spawn } from "child_process";
import yahooFinance from "yahoo-finance2";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Elliott-Wellen-Analyst Bot läuft im optimierten Modus...");

interface ChatSession {
  lastScreenshotBuffer: Buffer | null;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseIntervalForWidget(input: string): string {
  const clean = input.toLowerCase().trim();
  if (clean === "1m" || clean === "m" || clean === "mo" || clean === "monat") return "M";
  if (clean === "1w" || clean === "w" || clean === "woche") return "W";
  if (clean === "1d" || clean === "d" || clean === "tag") return "D";
  
  if (clean === "1" || clean === "1min") return "1";
  if (clean === "5m" || clean === "5") return "5";
  if (clean === "15m" || clean === "15") return "15";
  if (clean === "30m" || clean === "30") return "30";
  if (clean === "1h" || clean === "60") return "60";
  if (clean === "2h" || clean === "120") return "120";
  if (clean === "4h" || clean === "240") return "240";
  
  return "D";
}

function parseIntervalForYahoo(input: string): "1m" | "2m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1h" | "1d" | "5d" | "1wk" | "1mo" | "3mo" {
  const clean = input.toLowerCase().trim();
  if (clean === "1m" || clean === "m") return "1mo";
  if (clean === "1w" || clean === "w") return "1wk";
  if (clean === "1d" || clean === "d") return "1d";
  if (clean === "4h") return "1h";
  if (clean === "1h") return "1h";
  return "1d";
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

  const yahooSymbol = symbol.includes(":") ? symbol.split(":")[1] : symbol;
  const widgetInterval = parseIntervalForWidget(rawInterval);
  const yahooInterval = parseIntervalForYahoo(rawInterval);

  await ctx.reply(`⏳ Extrahiere numerische Kursdaten für ${yahooSymbol} über Yahoo Finance...`);

  let historicalData = "";
  try {
    const today = new Date();
    const priorDate = new Date(new Date().setDate(today.getDate() - 500));
    
    const queryResult: any = await yahooFinance.historical(yahooSymbol, {
      period1: priorDate.toISOString().split("T")[0],
      interval: yahooInterval
    });

    if (queryResult && Array.isArray(queryResult)) {
      const slice = queryResult.slice(-60);
      historicalData = slice
        .map((c: any) => `Datum: ${c.date instanceof Date ? c.date.toISOString().split("T")[0] : String(c.date)} -> High: ${Number(c.high).toFixed(2)}, Low: ${Number(c.low).toFixed(2)}, Close: ${Number(c.close).toFixed(2)}`)
        .join("\n");
    }
  } catch (dataError) {
    console.warn("⚠️ Yahoo Finance Daten-Abruf fehlgeschlagen. Fahre rein visuell fort.");
  }

  await ctx.reply(`⏳ Rufe Widget-Chart für ${symbol} (${rawInterval}) ab...`);

  const browser = await chromium.launch({ 
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote"
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  await page.route("**/*.{woff,woff2,ttf,otf}*", (route) => route.abort());

  const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}&interval=${widgetInterval}&theme=dark`;

  try {
    // KORREKTUR: Time-out auf 60 Sekunden hochgesetzt für langsame Render-CPUs
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000); 

    await ctx.reply("📊 Stauche Zeitachse für optimale Candlestick-Anzeige...");
    await page.mouse.click(960, 540);
    await page.waitForTimeout(500);

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(2000); 

    await ctx.reply("📸 Erstelle Screenshot und berechne Elliott-Wellen-Koordinaten...");

    const chartElement = page.locator("div.tv-embed-widget-wrapper, iframe, body");
    const screenshotBuffer = await chartElement.first().screenshot({ type: "jpeg", quality: 90 });
    await browser.close();

    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    const jsonPrompt = `Du bist ein unbestechlicher Elliott-Wellen-Analyst. Vor dir liegt ein TradingView-Chart (1920x1080 Pixel).
Der reale Kerzenbereich befindet sich AUSSCHLIESSLICH vertikal zwischen Y = 180 und Y = 850. Alles außerhalb ist leerer Raum.

Hier sind die ECHTEN, mathematischen Kursdaten der im Chart sichtbaren Kerzen:
${historicalData || "Keine numerischen Daten verfügbar. Nutze ausschließlich die visuelle Struktur."}

Deine Aufgabe:
1. Gleiche das Chartbild mit den echten Kursdaten ab.
2. Identifiziere die echten strukturellen Hochs und Tiefs. Setze NIEMALS Punkte in den leeren Raum links oder in den Himmel oberhalb der Kerzen.
3. Ordne den Wendepunkten die korrekten Wellen-Labels (1-5, A-C, W-X-Y) zu. Chronologisch sortiert von links nach rechts.

Befülle das JSON-Schema präzise. Die X/Y Koordinaten müssen exakt auf den realen Spitzen/Tälern des Kursverlaufs im Bild liegen.`;

    let responseText = "";
    let attempts = 3;
    
    while (attempts > 0) {
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [imagePart, jsonPrompt],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                analysis_text: { type: Type.STRING, description: "Kompakte technische Analyse basierend auf den echten Zahlenwerten." },
                waves: {
                  type: Type.ARRAY,
                  description: "Chronologische Liste der Wellenpunkte, exakt auf den realen Kerzen platziert.",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING },
                      x: { type: Type.INTEGER },
                      y: { type: Type.INTEGER }
                    },
                    required: ["label", "x", "y"]
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
        if (apiError.status === 503 || apiError.message?.includes("503")) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          throw apiError;
        }
      }
    }

    const result = JSON.parse(responseText.trim());
    const wavesData = result.waves || [];
    const analysisText = result.analysis_text || "Keine Analyse generiert.";

    chatSessions[chatId] = {
      lastScreenshotBuffer: screenshotBuffer,
      history: [
        { role: "user", text: "[Chart-Bild] + Numerische Daten analysiert." },
        { role: "model", text: analysisText }
      ]
    };

    await ctx.reply("🎨 Zeichne Elliott-Wellen-Muster in das Bild...");

    const jsonArg = JSON.stringify({ waves: wavesData });
    const pythonProcess = spawn("python3", ["python_service/drawer.py", jsonArg]);
    
    const stdoutChunks: Buffer[] = [];
    let stderrText = "";

    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    pythonProcess.stderr.on("data", (data) => stderrText += data.toString());

    pythonProcess.on("close", async (code) => {
      if (code !== 0 || stdoutChunks.length === 0) {
        console.error("❌ Python-Fehler:", stderrText);
        await ctx.replyWithPhoto({ source: screenshotBuffer }, { caption: `📊 Chart: ${symbol} (${rawInterval})` });
      } else {
        const outputBuffer = Buffer.concat(stdoutChunks);
        await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📈 Elliott-Wellen-Zählung: ${symbol} (${rawInterval})` });
      }

      await ctx.reply(`📝 <b>Elliott-Wellen-Analyse:</b>\n\n${convertToTelegramHTML(analysisText)}`, { parse_mode: "HTML" });
    });

    if (pythonProcess.stdin) {
      pythonProcess.stdin.write(screenshotBuffer);
      pythonProcess.stdin.end();
    }

  } catch (error: any) {
    await browser.close();
    console.error("❌ Haupt-Fehler:", error);
    await ctx.reply(`❌ Fehler bei der Analyse: ${error.message}`);
  }
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastScreenshotBuffer) {
    return ctx.reply("❌ Ich habe noch keinen Chart im Speicher. Bitte starte zuerst eine Analyse mit `/analyse`.");
  }

  await ctx.reply("🤔 Analysiere deine Rückfrage zum Chart...");

  try {
    const imagePart = {
      inlineData: {
        data: session.lastScreenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    session.history.push({ role: "user", text: userQuestion });

    const contents: any[] = [imagePart];
    session.history.forEach(msg => {
      contents.push(`${msg.role === "user" ? "User" : "Model"}: ${msg.text}`);
    });
    contents.push("Beantworte die letzte Frage des Users bezogen auf den Chart und die vorherige Zählung. Halte dich kurz.");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents
    });

    const answerText = response.text || "Ich konnte keine Antwort generieren.";
    session.history.push({ role: "model", text: answerText });

    await ctx.reply(`💬 <b>Antwort zu deiner Rückfrage:</b>\n\n${convertToTelegramHTML(answerText)}`, { parse_mode: "HTML" });

  } catch (error: any) {
    console.error("❌ Rückfrage-Fehler:", error);
    await ctx.reply(`❌ Fehler bei der Beantwortung: ${error.message}`);
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
