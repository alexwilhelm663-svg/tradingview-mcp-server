// @ts-nocheck
import { Telegraf } from "telegraf";
import { addToRadar, removeFromRadar, viewRadar, getRadarWatchlist } from "./radarManager";
import { analyzeAsset } from "./engine";
import { runAutoScan } from "./scheduler";
import { GoogleGenerativeAI } from "@google/generative-ai";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN ist nicht in den Umweltvariablen gesetzt!");

const bot = new Telegraf(token);

bot.command("start", (ctx) => {
  ctx.reply(
    "🤖 **ElliotEugen Trading Bot bereit.**\n\n" +
    "Verfügbare Befehle:\n" +
    "• `/radar` - Zeigt die aktuelle Watchlist\n" +
    "• `/add <SYMBOL>` - Asset zum Radar hinzufügen (z.B. `/add BTC-USD`)\n" +
    "• `/remove <SYMBOL>` - Asset vom Radar entfernen\n" +
    "• `/analyse <SYMBOL>` - Sofortige EW-Analyse\n" +
    "• `/scan` - Startet sofort einen manuellen Radar-Durchlauf",
    { parse_mode: "Markdown" }
  );
});

bot.command("radar", (ctx) => {
  ctx.reply(viewRadar(), { parse_mode: "Markdown" });
});

bot.command("add", (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("⚠️ Bitte Symbol angeben: `/add BTC-USD`", { parse_mode: "Markdown" });
  const msg = addToRadar(args[1]);
  ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command("remove", (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("⚠️ Bitte Symbol angeben: `/remove TSLA`", { parse_mode: "Markdown" });
  const msg = removeFromRadar(args[1]);
  ctx.reply(msg, { parse_mode: "Markdown" });
});

bot.command("scan", async (ctx) => {
  ctx.reply("⚙️ Starte manuellen Radar-Scan im Hintergrund...");
  await runAutoScan();
  ctx.reply("✅ Radar-Scan abgeschlossen!");
});

bot.command("analyse", async (ctx) => {
  const args = ctx.message.text.split(" ");
  if (args.length < 2) return ctx.reply("⚠️ Bitte Symbol angeben: `/analyse NVDA`", { parse_mode: "Markdown" });
  
  const symbol = args[1].trim().toUpperCase();
  const statusMsg = await ctx.reply(`🔄 Analysiere **${symbol}** nach Elliott-Wellen...`, { parse_mode: "Markdown" });

  try {
    // FIX: genAI entfernt, da Workflow intern agiert
    const result = await analyzeAsset(symbol);
    
    let caption = `📊 **EW Master Analyse: ${symbol}**\nMakro-Trend: \`${result.finalTrend}\`\n\n`;
    
    if (result.isHotSetup) caption += `${result.killZoneStatus}\n`;
    if (result.isBreakoutSetup) caption += `${result.breakoutStatus}\n`;
    if (!result.isHotSetup && !result.isBreakoutSetup) caption += "⚪ Aktuell in keiner Trigger-Zone.";

    if (result.buffer) {
      await ctx.replyWithPhoto({ source: result.buffer }, { caption, parse_mode: "Markdown" });
    } else {
      await ctx.reply(caption, { parse_mode: "Markdown" });
    }
  } catch (err: any) {
    ctx.reply(`❌ **Fehler bei Analyse von ${symbol}:**\n\`${err.message}\``, { parse_mode: "Markdown" });
  } finally {
    ctx.deleteMessage(statusMsg.message_id).catch(() => {});
  }
});

bot.launch().then(() => {
  console.log("🚀 Telegram Bot 'ElliotEugen' erfolgreich gestartet!");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
