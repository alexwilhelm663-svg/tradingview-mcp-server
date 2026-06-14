import { GoogleGenAI, Type } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";
import { exec } from "child_process";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Elliott-Wellen-Analyst Bot läuft mit sicherem JSON-Schema...");

interface ChatSession {
  lastScreenshotBuffer: Buffer | null;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseIntervalForWidget(input: string): string {
  const clean = input.toLowerCase().trim();
  if (clean === "1d" || clean === "d") return "D";
  if (clean === "1w" || clean === "w") return "W";
  if (clean === "1m" || clean === "m") return "1";
  if (clean === "5m") return "5";
  if (clean === "15m") return "15";
  if (clean === "1h") return "60";
  if (clean === "2h") return "120";
  if (clean === "4h") return "240";
  return "D";
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

    const jsonPrompt = `Du bist ein präziser Elliott-Wellen-Analyst. Scanne diesen Weitwinkel-Chart.
Führe eine mathematisch-visuelle Zählung durch (Impulswelle 1-5 oder Korrektur A-C).
Befülle die geforderten JSON-Felder exakt. Nutze geschätzte X/Y Pixel-Koordinaten bezogen auf das 1920x1080 Bild, um die Linienpunkte direkt auf die Spitzen/Täler der Kerzen zu setzen.`;

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
                  description: "Liste der Wellen-Scheitelpunkte in chronologischer Reihenfolge.",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      label: { type: Type.STRING, description: "Ziffer oder Buchstabe der Welle (z.B. 1, 2, 3, 4, 5, A, B, C)" },
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

    const jsonArg = JSON.stringify(wavesData);
    const pythonProcess = exec(`python3 python_service/drawer.py '${jsonArg}'`, { encoding: "buffer" }, async (drawError: any, stdout: Buffer, stderr: any) => {
      if (drawError) {
        console.error("❌ Python-Fehler:", stderr.toString());
        await ctx.replyWithPhoto({ source: screenshotBuffer }, { caption: `📊 Chart: ${symbol} (${rawInterval})` });
      } else {
        await ctx.replyWithPhoto({ source: stdout }, { caption: `📈 Elliott-Wellen-Zählung: ${symbol} (${rawInterval})` });
      }

      await ctx.reply(`📝 <b>Elliott-Wellen-Analyse:</b>\n\n${convertToTelegramHTML(analysisText)}`, { parse_mode: "HTML" });
    });

    // KORREKTUR: Null-Check für stdin, um TypeScript-Compiler zufrieden zu stellen
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
