// @ts-nocheck
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

console.log("🚀 Bot V110.1: Hybrid Dual-Hunter (Dips & Breakouts) aktiv...");

let db: Database;
let activeChatId: number | null = null;

async function initDB() {
    if (!fs.existsSync('./data')) { fs.mkdirSync('./data', { recursive: true }); }
    db = await open({ filename: './data/bot_memory.sqlite', driver: sqlite3.Database });
    await db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY, source TEXT DEFAULT 'MANUAL');
        CREATE TABLE IF NOT EXISTS alerts (symbol TEXT PRIMARY KEY, last_alert_timestamp INTEGER);
        CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    `);
    try { await db.exec(`ALTER TABLE watchlist ADD COLUMN source TEXT DEFAULT 'MANUAL'`); } catch(e) {}
    const storedChat = await db.get(`SELECT value FROM config WHERE key = 'chat_id'`);
    if (storedChat) activeChatId = parseInt(storedChat.value);

    const count = await db.get(`SELECT COUNT(*) as c FROM watchlist`);
    if (count.c === 0) {
        const defaultList = ["AAPL", "NVDA", "TSLA", "ARM", "PLTR", "IONQ", "MSTR", "AMD", "GOOGL", "PYPL", "BAYN.DE"];
        for (const sym of defaultList) { await db.run(`INSERT INTO watchlist (symbol, source) VALUES (?, 'MANUAL')`, sym); }
    }
    console.log(`💾 SQLite Dual-Origin loaded. Active Chat: ${activeChatId || 'None'}`);
}
initDB().catch(console.error);

async function updateChatId(id: number) {
    activeChatId = id;
    await db.run(`INSERT OR REPLACE INTO config (key, value) VALUES ('chat_id', ?)`, id.toString());
}

function extractTickersFromReport(text: string): string[] {
    const lines = text.split('\n'); const found: string[] = [];
    const tickerRegex = /^([A-Z0-9.\-]{2,8})\s+[-]?\d/;
    for (const l of lines) {
        const m = l.trim().match(tickerRegex);
        if (m) {
            const sym = m[1].trim();
            if (!['CRV', 'OSC', 'EXP', 'AUSBR', 'KORR', 'TK', 'EW'].includes(sym)) found.push(sym);
        }
    }
    return Array.from(new Set(found));
}

async function processScreenReport(text: string, chatId: number) {
    const parsedTickers = extractTickersFromReport(text);
    if (parsedTickers.length === 0) return bot.telegram.sendMessage(chatId, "⚠️ Keine validen Ticker extrahiert.");

    const oldScreenRows = await db.all(`SELECT symbol FROM watchlist WHERE source = 'SCREEN'`);
    const oldSet = new Set(oldScreenRows.map(r => r.symbol));
    const toRemove = Array.from(oldSet).filter(x => !new Set(parsedTickers).has(x));

    for (const sym of toRemove) await db.run(`DELETE FROM watchlist WHERE symbol = ? AND source = 'SCREEN'`, sym);
    for (const sym of parsedTickers) await db.run(`INSERT OR REPLACE INTO watchlist (symbol, source) VALUES (?, 'SCREEN')`, sym);

    const total = await db.get(`SELECT COUNT(*) as c FROM watchlist`);
    await bot.telegram.sendMessage(chatId, `📥 **IMPORT ERFOLGREICH**\nRadar überwacht nun ${total.c} Assets.`);
}

async function runRadarScan(targetChatId: number) {
  const rows = await db.all(`SELECT symbol, source FROM watchlist`);
  if (rows.length === 0) return;

  console.log(`[CRON] Starte Hybrid-Radar-Scan für ${rows.length} Assets...`);
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

  for (const row of rows) {
      const sym = row.symbol;
      const isScreenAsset = row.source === 'SCREEN';
      
      try {
          const record = await db.get(`SELECT last_alert_timestamp FROM alerts WHERE symbol = ?`, sym);
          if (record && (now - record.last_alert_timestamp) < SEVEN_DAYS_MS) continue;

          await new Promise(r => setTimeout(r, 2500)); 
          
          // FIX: Nur noch 1 Argument
          const res = await analyzeAsset(sym);
          
          if (res.signal === "YES") {
              let triggerAlert = false;
              let msgCaption = "";

              if (res.isHotSetup) {
                  triggerAlert = true;
                  msgCaption = `🎯 **RADAR HIT (DEEP DIP): ${sym}**\n${res.killZoneStatus}`;
              } else if (res.isBreakoutSetup && isScreenAsset) {
                  triggerAlert = true;
                  msgCaption = `🚀 **RADAR HIT (BREAKOUT!): ${sym}**\n${res.breakoutStatus}`;
              }

              if (triggerAlert) {
                  await db.run(`INSERT OR REPLACE INTO alerts (symbol, last_alert_timestamp) VALUES (?, ?)`, sym, now);
                  if (res.buffer) {
                      await bot.telegram.sendPhoto(targetChatId, { source: res.buffer }, { caption: msgCaption });
                  } else {
                      await bot.telegram.sendMessage(targetChatId, msgCaption);
                  }
              }
          }
      } catch (err) { console.error(`Fehler bei ${sym}:`, err); }
  }
}

// Bot Events
bot.on('text', async (ctx) => {
    const msg = ctx.message.text;
    if (msg.startsWith('/start')) await updateChatId(ctx.chat.id);
    if (msg.startsWith('/report')) await processScreenReport(msg, ctx.chat.id);
});

// Server starten
const server = http.createServer((req, res) => res.end("Bot active"));
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
bot.launch();

