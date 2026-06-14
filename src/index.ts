import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";
import { spawn } from "child_process";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Elliott-Wellen-Analyst Bot läuft mit korrigiertem Monats-Parsing...");

interface ChatSession {
  lastScreenshotBuffer: Buffer | null;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

// Korrigierte Funktion für das TradingView-Widget
function parseIntervalForWidget(input: string): string {
  const clean = input.toLowerCase().trim();
  
  // Monats-, Wochen- und Tages-Charts
  if (clean === "1m" || clean === "m" || clean === "mo" || clean === "monat") return "M"; // "M" = Monthly (Monat)
  if (clean === "1w" || clean === "w" || clean === "woche") return "W";                  // "W" = Weekly (Woche)
  if (clean === "1d" || clean === "d" || clean === "tag") return "D";                    // "D" = Daily (Tag)
  
  // Intraday Minuten- und Stunden-Intervalle (Widget erwartet reine Zahlen-Strings für Minuten)
  if (clean === "1" || clean === "1min" || clean === "1p") return "1";                  // "1" = 1 Minute
  if (clean === "5m" || clean === "5") return "5";                                      // "5" = 5 Minuten
  if (clean === "15m" || clean === "15") return "15";                                  // "15" = 15 Minuten
  if (clean === "30m" || clean === "30") return "30";                                  // "30" = 30 Minuten
  if (clean === "1h" || clean === "60") return "60";                                    // "60" = 1 Stunde (60 Min)
  if (clean === "2h" || clean === "120") return "120";                                  // "120" = 2 Stunden (120 Min)
  if (clean === "4h" || clean === "240") return "240";                                  // "240" = 4 Stunden (240 Min)
  
  return "D"; // Standard-Fallback auf Tagesbasis
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
  const symbol = args[1];
  const rawInterval = args[2] || "1D";
  const widgetInterval = parseIntervalForWidget(rawInterval);

  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse NASDAQ:TSLA 4h");
  }

  await ctx.reply(`⏳ Rufe Widget-Chart für ${symbol} (${rawInterval}) ab...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  await page.route("**/*.{woff,woff2,ttf,otf}*", (route) => route.abort());

  const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}&interval=${widgetInterval}&theme=dark`;

  try {
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000); 

    await ctx.reply("📊 Stauche Zeitachse für mehr Candlesticks...");
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

    const jsonPrompt = `Du bist ein flexibler Elliott-Wellen-Analyst. Vor dir liegt ein TradingView-Chart auf einem Raster von 1920x1080 Pixeln (Kerzenbereich Y = 150 bis 850).

Scanne den Chart und bestimme das dominierende, sichtbare Wellenmuster. Du musst NICHT zwingend einen gesamten 8-Punkte-Zyklus erzwingen.
- Wenn du einen sauberen Impuls siehst, zeichne die Wellen 1-5 (oder so weit, wie er fortgeschritten ist, z.B. 1-3) ein.
- Wenn der Markt sich in einer klaren Korrektur befindet, zeichne NUR die Korrekturwellen ein (z.B. A-B-C oder komplexe Korrekturen wie W-X-Y).

Regeln für deine Koordinaten-Vergabe:
1. Setze Spitzen (z.B. 1, 3, 5, B) direkt auf lokale Hochpunkte der Kerzen-Dochte.
2. Setze Täler (z.B. 2, 4, A, C) direkt auf lokale Tiefpunkte der Kerzen-Dochte.
3. Versuche, die Koordinaten so präzise wie möglich zu schätzen, damit die Verbindungslinien die realen Wendepunkte im Chart berühren. Platziere NIEMALS Punkte im leeren Raum außerhalb der Kursdaten.

Befülle das JSON-Schema flexibel je nach Wellenanzahl. Nutze den 'analysis_text', um deine Zählung unbeschönigt nach den Prechter-Regeln zu begründen.`;

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
                analysis_text: { 
                  type: Type.STRING, 
                  description: "Kompakte technische Analyse und Wellengrad-Erklärung (max 1500 Zeichen)." 
                },
                waves: {
                  type: Type.ARRAY,
                  description: "Liste der identifizierten Wellen-Scheitelpunkte in chronologischer Reihenfolge (variable Länge von 2 bis 8 Elementen).",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING, description: "Ziffer oder Buchstabe der Welle (z.B. 1, 2, 3, 4, 5, A, B, C, W, X, Y)" },
                      x: { type: Type.INTEGER, description: "X-Koordinate im Pixelbereich 0-1920" },
                      y: { type: Type.INTEGER, description: "Y-Koordinate im Pixelbereich 0-1080" }
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
        { role: "user", text: "[Chart-Bild] + Elliott-Wellen-Analyse angefordert." },
        { role: "model", text: analysisText }
      ]
    };

    await ctx.reply("🎨 Zeichne Elliott-Wellen-Muster in das Bild...");

    const jsonArg = JSON.stringify({ waves: wavesData });
    const pythonProcess = spawn("python3", ["python_service/drawer.py", jsonArg]);
    
    const stdoutChunks: Buffer[] = [];
    let stderrText = "";

    pythonProcess.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    pythonProcess.stderr.on("data", (data) => {
      stderrText += data.toString();
    });

    pythonProcess.on("close", async (code) => {
      if (code !== 0 || stdoutChunks.length === 0) {
        console.error("❌ Python-Fehler oder leere Ausgabe:", stderrText);
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
    } else {
      throw new Error("Konnte den Bild-Stream an Python nicht öffnen.");
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

  await ctx.reply("🤔 Analysiere deine Rückfrage zum Chart......");

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
