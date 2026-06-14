import { GoogleGenAI } from "@google/genai";
import { Telegraf } from "telegraf";
import { chromium } from "playwright";

// Initialisierung der APIs über Umgebungsvariablen
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log("🤖 Telegram Chart-Analyst Bot läuft mit stabiler HTML-Ausgabe...");

// Hilfsfunktion, um gängige Intervalle für das TV-Widget sauber zu konvertieren
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
  return "D"; // Standard-Fallback, falls nichts übergeben wurde
}

// Konvertiert einfaches Markdown von Gemini in absolut sicheres Telegram-HTML
function convertToTelegramHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>") // Fett-Formatierung: **text** -> <b>text</b>
    .replace(/\*(.*?)\*/g, "<i>$1</i>")     // Kursiv-Formatierung: *text* -> <i>text</i>
    .replace(/`(.*?)`/g, "<code>$1</code>"); // Monospace/Codeblock: `text` -> <code>text</code>
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
  
  // Schriften blockieren, um das Laden im Docker-Container massiv zu beschleunigen
  await page.route("**/*.{woff,woff2,ttf,otf}*", (route) => route.abort());

  // Die extrem schnelle und schlanke Widget-URL
  const
    
