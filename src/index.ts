import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Chart-Analyst Bot läuft mit stabiler HTML-Ausgabe...");

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

// Konvertiert einfaches Markdown von Gemini in sicheres Telegram-HTML
function convertToTelegramHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") // Fett: **text** -> <b>text</b>
    .replace(/\*(.*?)\*/g, "<i>$1</i>")     // Kursiv: *text* -> <i>text</i>
    .replace(/`(.*?)`/g, "<code>$1</code>"); // Codeblock: `text` -> <code>text</code>
}

bot.command("analyse", async (ctx) => {
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
    await page.waitForTimeout(4000); 

    await ctx.reply("📸 Erstelle Screenshot und starte Gemini 2.5 Flash...");

    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 90 });
    await browser.close();

    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    // Präziser Prompt mit Längenbegrenzung, um die 4096 Zeichen niemals zu sprengen
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      contents: [
        imagePart,
        "Du bist ein Experte für technische Finanzanalyse. Analysiere diesen TradingView-Chart. Bestimme präzise die Marktstruktur (Support/Resistance) und den aktuellen Trend. Achte auf Candlestick-Muster sowie Indikatoren (oder Elliott-Wellen/Fibonacci-Level, falls sichtbar). Gib ein klares Fazit ab. WICHTIG: Halte deine gesamte Antwort kompakt, prägnant und beschränke dich auf maximal 2000 Zeichen."
      ],
    });

    // 1. Reines Bild senden
    await ctx.replyWithPhoto(
      { source: screenshotBuffer },
      { caption: `📊 Chart: ${symbol} (${rawInterval})` }
    );

    // 2. Text in HTML umwandeln und senden
    const htmlText = convertToTelegramHTML(response.text || "Keine Analyse generiert.");
    await ctx.reply(`📝 <b>Technische Analyse:</b>\n\n${htmlText}`, { parse_mode: "HTML" });

  } catch (error: any) {
    await browser.close();
    console.error("❌ Fehler bei der Ausführung:", error);
    await ctx.reply(`❌ Fehler bei der Analyse: ${error.message}`);
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
