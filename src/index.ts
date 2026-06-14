import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";

// Initialisierung der APIs über Umgebungsvariablen
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Chart-Analyst Bot wird gestartet...");

// Reagiert auf den Befehl /analyse [SYMBOL] [INTERVALL]
// Beispiel im Telegram-Chat: /analyse BINANCE:BTCUSDT 4h
bot.command("analyse", async (ctx) => {
  const args = ctx.message.text.split(" ");
  const symbol = args[1];
  const interval = args[2] || "1D"; // Standardmäßig 1 Tag, falls nichts angegeben

  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse NASDAQ:TSLA 4h");
  }

  await ctx.reply(`⏳ Starte Analyse für ${symbol} (${interval}). Bitte warten...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;

  try {
    // 1. Chart laden und Screenshot machen
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000); // Warten auf Indikatoren
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 90 });
    await browser.close();

    await ctx.reply("📸 Screenshot erstellt. Gemini analysiert jetzt die Chartstruktur...");

    // 2. Bild für Gemini vorbereiten
    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    // 3. Gemini-Analyse anfordern
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        imagePart,
        "Du bist ein professioneller technischer Analyst. Analysiere diesen TradingView-Chart präzise. Achte auf Marktstruktur (Support/Resistance), Candlestick-Muster und Indikatoren (z.B. Elliott-Wellen oder Fibonacci-Level, falls erkennbar). Gib ein klares charttechnisches Fazit ab."
      ],
    });

    // 4. Screenshot und Text zusammen zurück an dein Handy schicken
    await ctx.replyWithPhoto(
      { source: screenshotBuffer },
      { caption: `📊 *Analyse für ${symbol} (${interval})*\n\n${response.text}`, parse_mode: "Markdown" }
    );

  } catch (error: any) {
    await browser.close();
    console.error(error);
    await ctx.reply(`❌ Fehler bei der Analyse: ${error.message}`);
  }
});

// Bot starten
bot.launch();

// Sanfter Shutdown bei Server-Stopp
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
