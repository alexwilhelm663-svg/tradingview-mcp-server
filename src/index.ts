import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Chart-Analyst Bot wird gestartet...");

bot.command("analyse", async (ctx) => {
  const args = ctx.message.text.split(" ");
  const symbol = args[1];
  const interval = args[2] || "1D";

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

  // Schriften und Tracker blockieren, um das Laden radikal zu beschleunigen
  await page.route("**/*.{woff,woff2,ttf,otf}*", (route) => route.abort());
  await page.route("**/*analytics*", (route) => route.abort());

  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;

  try {
    // FELSENFEST: Wir warten NUR auf das Standard-Laden, KEIN networkidle mehr!
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    console.log("📊 Grundseite geladen. Warte 8 Sekunden auf Indikatoren...");
    
    // Wir geben der Seite manuell Zeit, die Kerzen zu zeichnen
    await page.waitForTimeout(8000); 

    await ctx.reply("📸 Erstelle Screenshot...");

    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 90 });
    await browser.close();

    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [
        imagePart,
        "Du bist ein professioneller Experte für technische Analyse. Analysiere diesen TradingView-Chart präzise. Bestimme die primäre Marktstruktur und den Trend. Achte auf markante Candlestick-Muster sowie auf Indikatoren, Fibonacci-Level oder Elliott-Wellen-Zählungen, falls diese im Chart eingezeichnet oder erkennbar sind. Gib ein unbeschönigtes, klares Fazit ab."
      ],
    });

    await ctx.replyWithPhoto(
      { source: screenshotBuffer },
      { caption: `📊 *Analyse für ${symbol} (${interval})*\n\n${response.text}`, parse_mode: "Markdown" }
    );

  } catch (error: any) {
    await browser.close();
    console.error("❌ Fehler bei der Ausführung:", error);
    await ctx.reply(`❌ Fehler bei der Analyse: ${error.message}`);
  }
});

bot.launch().then(() => {
  console.log("🚀 Bot läuft erfolgreich und wartet auf Nachrichten!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
