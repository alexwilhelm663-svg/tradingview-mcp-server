import { Telegraf } from "telegraf";
import http from "http";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sqlite3 from "sqlite3";
import { open, Database } from "sqlite";
import cron from "node-cron";
import { analyzeAsset } from "./engine";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V104.2: Slim Server & Telegraf Router aktiv...");

let db: Database;
let activeChatId: number | null = null;

async function initDB() {
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data', { recursive: true });
    }
    db = await open({ filename: './data/bot_memory.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS alerts (symbol TEXT PRIMARY KEY, last_alert_timestamp INTEGER);
    `);
    const count = await db.get(`SELECT COUNT(*) as c FROM watchlist`);
    if (count.c === 0) {
        const defaultList = ["AAPL", "NVDA", "TSLA", "ARM", "PLTR", "IONQ", "MSTR", "AMD", "GOOGL", "PYPL", "BAYN.DE"];
        for (const sym of defaultList) { await db.run(`INSERT INTO watchlist (symbol) VALUES (?)`, sym); }
    }
    console.log("💾 SQLite Memory Core geladen.");
}
initDB().catch(console.error);

async function runRadarScan(targetChatId: number) {
  const rows = await db.all(`SELECT symbol FROM watchlist`);
  if (rows.length === 0) {
      await bot.telegram.sendMessage(targetChatId, "❌ Automatischer Scan abgebrochen: Watchlist leer.");
      return;
  }

  console.log(`[CRON] Starte autonomen Radar-Scan für ${rows.length} Assets...`);
  let hits = 0; const now = Date.now();

  for (const row of rows) {
      const sym = row.symbol;
      try {
          const record = await db.get(`SELECT last_alert_timestamp FROM alerts WHERE symbol = ?`, sym);
          if (record && (now - record.last_alert_timestamp) < (7 * 24 * 3600 * 1000)) continue;

          await new Promise(r => setTimeout(r, 2500)); 
          const res = await analyzeAsset(sym, genAI);
          
          if (res.isHotSetup && res.finalTrend === "IMPULSE_UP") {
              hits++;
              await db.run(`INSERT OR REPLACE INTO alerts (symbol, last_alert_timestamp) VALUES (?, ?)`, sym, now);
              await bot.telegram.sendPhoto(targetChatId, { source: res.buffer }, { 
                  caption: `🎯 **AUTOMATISCHER RADAR HIT: ${sym}**\n${res.killZoneStatus}\n(7 Tage Stummschaltung aktiv).` 
              });
          }
      } catch (e) { console.error(`[CRON SKIP] Fehler bei ${sym}:`, e); }
  }
  console.log(`[CRON] Scan beendet. Hits: ${hits}`);
}

cron.schedule("15 22 * * *", async () => {
    if (activeChatId) {
        await bot.telegram.sendMessage(activeChatId, "📡 **Automatischer Abend-Scan ausgelöst (NYSE Close)...**");
        await runRadarScan(activeChatId);
    }
});

// ============================================================================
// TELEGRAM COMMANDS
// ============================================================================

bot.command("add", async (ctx) => {
    activeChatId = ctx.chat.id; 
    const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
    if (!sym) return ctx.reply("❌ Symbol angeben!");
    await db.run(`INSERT OR IGNORE INTO watchlist (symbol) VALUES (?)`, sym);
    await ctx.reply(`✅ ${sym} hinzugefügt.`);
});

bot.command("rm", async (ctx) => {
    activeChatId = ctx.chat.id;
    const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
    if (!sym) return ctx.reply("❌ Symbol angeben!");
    await db.run(`DELETE FROM watchlist WHERE symbol = ?`, sym);
    await ctx.reply(`🗑️ ${sym} entfernt.`);
});

bot.command("watchlist", async (ctx) => {
    activeChatId = ctx.chat.id;
    const rows = await db.all(`SELECT symbol FROM watchlist`);
    await ctx.reply(rows.length === 0 ? "📭 Watchlist leer." : `📋 **Radar-Watchlist:**\n${rows.map(r => `• ${r.symbol}`).join("\n")}`);
});

bot.command("analyse", async (ctx) => {
  activeChatId = ctx.chat.id;
  const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
  if (!sym) return ctx.reply("❌ Symbol angeben!");
  await ctx.reply(`⏳ Scan läuft: ${sym}...`);
  try {
      const result = await analyzeAsset(sym, genAI);
      await ctx.replyWithPhoto({ source: result.buffer }, { caption: `📊 EW Master (${result.finalTrend}): ${sym}` + (result.killZoneStatus ? `\n\n${result.killZoneStatus}` : "") });
  } catch (e: any) { await ctx.reply(`⚠️ Fehler: ${e.message}`); }
});

bot.command("radar", async (ctx) => {
  activeChatId = ctx.chat.id;
  await ctx.reply(`📡 **MANUELLER RADAR-START**...`);
  await runRadarScan(ctx.chat.id);
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => { res.writeHead(200); res.end("ok"); try { bot.handleUpdate(JSON.parse(body)); } catch (e) {} });
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
