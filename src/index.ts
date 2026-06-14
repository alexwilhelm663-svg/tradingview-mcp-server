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
    // 1. Chart laden (Wir warten auf das DOM, da TradingView permanent Daten streamt)
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    console.log("📊 Chart-Grundgerüst geladen. Warte 6 Sekunden auf Kerzen und Indikatoren...");
    
    // Dem Chart Zeit geben, sich visuell vollständig aufzubauen
    await page.waitForTimeout(6000); 

    await ctx.reply("📸 Screenshot wird erstellt. Gemini analysiert jetzt die Chartstruktur...");

    // 2. Screenshot aufnehmen (_bypassFontLoading verhindert Timeouts durch fehlende System-Schriftarten)
    const screenshotBuffer = await page.screenshot({ 
      type: "jpeg", 
      quality: 90,
      // @ts-ignore
      _bypassFontLoading: true 
    });
    
    await browser.close();

    // 3. Bild für die Gemini API vorbereiten
    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    // 4. Gemini-Analyse anfordern
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro", // Bestes Modell für mathematisch-visuelle Analysen
      contents: [
        imagePart,
        "Du bist ein professioneller Experte für technische Analyse. Analysiere diesen TradingView-Chart präzise. Bestimme die primäre Marktstruktur und den Trend. Achte auf markante Candlestick-Muster sowie auf Indikatoren, Fibonacci-Level oder Elliott-Wellen-Zählungen, falls diese im Chart eingezeichnet oder erkennbar sind. Gib ein unbeschönigtes, klares Fazit ab."
      ],
    });

    // 5. Screenshot und Text zusammen zurück an dein Handy schicken
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

// Bot starten
bot.launch().then(() => {
  console.log("🚀 Bot läuft erfolgreich und wartet auf Nachrichten!");
});

// Sanfter Shutdown bei Server-Stopp
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
