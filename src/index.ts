import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Elliott-Wellen-Analyst Bot läuft mit maximaler Kerzen-Historie...");

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
    viewport: { width: 1920, height: 1080 }, // Hohe Auflösung, um viel Platz für viele Kerzen zu bieten
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  await page.route("**/*.{woff,woff2,ttf,otf}*", (route) => route.abort());

  const url = `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(symbol)}&interval=${widgetInterval}&theme=dark`;

  try {
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(3000); 

    await ctx.reply("📊 Stauche Zeitachse für mehr Candlesticks...");

    // OPTIMIERUNG: Wir klicken einmal in die Mitte des Charts, um ihn zu fokussieren
    await page.mouse.click(960, 540);
    await page.waitForTimeout(500);

    // Wir drücken die 'ArrowDown'-Taste simuliert 15 Mal hintereinander. 
    // Das zoomt auf der TradingView-Zeitachse heraus und presst deutlich mehr Kerzen in das Bild.
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(50); // Ganz kurze Pause für flüssiges Stauchen
    }
    
    // Nochmals kurz warten, damit sich das gestauchte Chart sauber setzt
    await page.waitForTimeout(2000); 

    await ctx.reply("📸 Erstelle Screenshot mit maximaler Historie...");

    const chartElement = page.locator("div.tv-embed-widget-wrapper, iframe, body");
    const screenshotBuffer = await chartElement.first().screenshot({ 
      type: "jpeg", 
      quality: 90 
    });
    
    await browser.close();

    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    let response;
    let attempts = 3;
    
    while (attempts > 0) {
      try {
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash", 
          contents: [
            imagePart,
            "Du bist ein Experte für die Elliott-Wellen-Theorie und technische Analyse. Vor dir liegt ein weit herausgezoomter Chart mit viel Historie, um übergeordnete Zyklen zu erkennen. Scanne diesen Chart präzise. Bestimme die primäre Marktstruktur und führe eine visuelle Elliott-Wellen-Zählung durch. Identifiziere, ob wir uns in einer Impulswelle (Wellen 1-5) oder einer Korrekturwelle (Wellen A, B, C) befinden. Beschreibe prägnant, wo du die Wellenspitzen und -täler siehst und prüfe die Kernregeln (z.B. Welle 3 darf nicht die kürzeste sein, Welle 2 korrigiert nicht über den Start von 1). Gib mir ein klares Fazit mit deiner primären Zählung. Halte deine Antwort kompakt und beschränke dich auf maximal 2000 Zeichen."
          ],
        });
        break;
      } catch (apiError: any) {
        attempts--;
        if (apiError.status === 503 || apiError.message?.includes("503")) {
          console.log(`⚠️ Google Server ausgelastet (503). Erneuter Versuch... (${attempts} Versuche übrig)`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          throw apiError;
        }
      }
    }

    if (!response) {
      throw new Error("Google API-Server dauerhaft überlastet. Bitte versuche es gleich noch einmal.");
    }

    await ctx.replyWithPhoto(
      { source: screenshotBuffer },
      { caption: `📊 Weitwinkel-Chart: ${symbol} (${rawInterval})` }
    );

    const htmlText = convertToTelegramHTML(response.text || "Keine Analyse generiert.");
    await ctx.reply(`📝 <b>Elliott-Wellen-Analyse:</b>\n\n${htmlText}`, { parse_mode: "HTML" });

  } catch (error: any) {
    await browser.close();
    console.error("❌ Fehler bei der Ausführung:", error);
    await ctx.reply(`❌ Fehler bei der Analyse: ${error.message}`);
  }
});

bot.launch().then(() => {
  console.log("🚀 Bot läuft erfolgreich im Weitwinkel-Historien-Modus!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
