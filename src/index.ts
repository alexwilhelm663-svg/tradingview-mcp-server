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
        // 🔥 FIX: Syntax-Fehler behoben
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
    const manualCount = await db.get(`SELECT COUNT(*) as c FROM watchlist WHERE source = 'MANUAL'`);

    await bot.telegram.sendMessage(chatId,
        `📥 **AUTOMATISCHER IMPORT ERFOLGREICH**\n\n` +
        `• Im Report importiert: \`${parsedTickers.length}\` Ticker\n` +
        `• Veraltete Screen-Werte gelöscht: \`-${toRemove.length}\`\n` +
        `• Manuelle Favoriten geschützt: \`${manualCount.c}\`\n\n` +
        `📡 **Radar scharfgeschaltet: Überwacht ab sofort ${total.c} Assets.**`
    );
}

// 🔥 BUILD 110.1: HYBRID RADAR ROUTER (ZWEI ALARM-KLASSEN)
async function runRadarScan(targetChatId: number) {
  const rows = await db.all(`SELECT symbol, source FROM watchlist`);
  if (rows.length === 0) return bot.telegram.sendMessage(targetChatId, "❌ Abbruch: Watchlist leer.");

  console.log(`[CRON] Starte Hybrid-Radar-Scan für ${rows.length} Assets...`);
  let hits = 0; let mutedCount = 0; const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

  for (const row of rows) {
      const sym = row.symbol;
      const isScreenAsset = row.source === 'SCREEN';
      
      try {
          const record = await db.get(`SELECT last_alert_timestamp FROM alerts WHERE symbol = ?`, sym);
          if (record && (now - record.last_alert_timestamp) < SEVEN_DAYS_MS) { mutedCount++; continue; }

          await new Promise(r => setTimeout(r, 2500)); 
          const res = await analyzeAsset(sym, genAI);
          
          if (res.finalTrend === "IMPULSE_UP") {
              let triggerAlert = false;
              let msgCaption = "";

              if (res.isHotSetup) {
                  triggerAlert = true;
                  msgCaption = `🎯 **RADAR HIT (DEEP DIP): ${sym}**\n${res.killZoneStatus}\n(7 Tage Cooldown aktiv).`;
              } else if (res.isBreakoutSetup && isScreenAsset) {
                  triggerAlert = true;
                  msgCaption = `🚀 **RADAR HIT (BREAKOUT!): ${sym}**\n${res.breakoutStatus}\n(7 Tage Cooldown aktiv).`;
              }

              if (triggerAlert) {
                  hits++;
                  await db.run(`INSERT OR REPLACE INTO alerts (symbol, last_alert_timestamp) VALUES (?, ?)`, sym, now);
                  await bot.telegram.sendPhoto(targetChatId, { source: res.buffer }, { caption: msgCaption });
              }
          }
      } catch (e) { console.error(`[CRON SKIP] Fehler bei ${sym}:`, e); }
  }

  if (hits === 0) {
      await bot.telegram.sendMessage(targetChatId, `🏁 **SCAN ABGESCHLOSSEN**\n\n• Radar-Watchlist: \`${rows.length}\` Werte\n• Neue Hits: \`0\`\n• Durch Cooldown blockiert: \`${mutedCount}\`\n\n*(Keine Aktie im Kauf-Dip oder frischen Report-Ausbruch).*`);
  } else {
      await bot.telegram.sendMessage(targetChatId, `🏁 **RADAR-DURCHLAUF BEENDET** (Gefundene Sniper-Signale: ${hits})`);
  }
}

cron.schedule("15 22 * * *", async () => { if (activeChatId) await runRadarScan(activeChatId); });

bot.on("text", async (ctx, next) => {
    const text = ctx.message.text; if (text.startsWith("/")) return next(); 
    await updateChatId(ctx.chat.id);
    if (text.includes("Elliott 1-2 Screen") || text.includes("Third-of-a-Third") || text.includes("Universum:")) {
        await processScreenReport(text, ctx.chat.id); return;
    }
    return next();
});

bot.command("add", async (ctx) => {
    await updateChatId(ctx.chat.id); const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
    if (!sym) return ctx.reply("❌ Symbol angeben!");
    await db.run(`INSERT OR REPLACE INTO watchlist (symbol, source) VALUES (?, 'MANUAL')`, sym);
    await ctx.reply(`✅ ${sym} (MANUAL) hinzugefügt.`);
});

bot.command("rm", async (ctx) => {
    await updateChatId(ctx.chat.id); const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
    if (!sym) return ctx.reply("❌ Symbol angeben!");
    await db.run(`DELETE FROM watchlist WHERE symbol = ?`, sym);
    await ctx.reply(`🗑️ ${sym} entfernt.`);
});

bot.command("watchlist", async (ctx) => {
    await updateChatId(ctx.chat.id); const rows = await db.all(`SELECT symbol, source FROM watchlist ORDER BY source, symbol`);
    await ctx.reply(rows.length === 0 ? "📭 Watchlist leer." : `📋 **Radar-Watchlist (${rows.length}):**\n${rows.map(r => `• \`${r.symbol.padEnd(8)}\` [${r.source}]`).join("\n")}`);
});

bot.command("analyse", async (ctx) => {
  await updateChatId(ctx.chat.id); const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
  if (!sym) return ctx.reply("❌ Symbol angeben!");
  await ctx.reply(`⏳ Scan läuft: ${sym}...`);
  try {
      const result = await analyzeAsset(sym, genAI);
      await ctx.replyWithPhoto({ source: result.buffer }, { caption: `📊 EW Master (${result.finalTrend}): ${sym}` + (result.killZoneStatus ? `\n\n${result.killZoneStatus}` : "") + (result.breakoutStatus ? `\n\n${result.breakoutStatus}` : "") });
  } catch (e: any) { await ctx.reply(`⚠️ Fehler: ${e.message}`); }
});

bot.command("radar", async (ctx) => { await updateChatId(ctx.chat.id); await ctx.reply(`📡 **MANUELLER HYBRID-RADAR-START**...`); await runRadarScan(ctx.chat.id); });

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => { res.writeHead(200); res.end("ok"); try { bot.handleUpdate(JSON.parse(body)); } catch (e) {} });
    } else if (req.url === "/api/report" && req.method === "POST") {
      let chunks: Buffer[] = []; req.on("data", c => chunks.push(c));
      req.on("end", async () => {
        res.writeHead(200); res.end("Report queued."); const text = Buffer.concat(chunks).toString('utf-8');
        if (activeChatId) {
            await bot.telegram.sendMessage(activeChatId, text);
            if (text.includes("Elliott 1-2 Screen") || text.includes("Third-of-a-Third") || text.includes("Universum:")) await processScreenReport(text, activeChatId);
        }
      });
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
