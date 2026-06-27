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

console.log("🚀 Bot V107: Dual-Origin Screener Ingestion Engine aktiv...");

let db: Database;
let activeChatId: number | null = null;

async function initDB() {
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data', { recursive: true });
    }
    db = await open({ filename: './data/bot_memory.sqlite', driver: sqlite3.Database });
    
    // 🔥 V107 MIGRATION: Erweitert bestehende Tabellen sicher um die 'source' Spalte
    await db.exec(`
        CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY, source TEXT DEFAULT 'MANUAL');
        CREATE TABLE IF NOT EXISTS alerts (symbol TEXT PRIMARY KEY, last_alert_timestamp INTEGER);
    `);
    try { await db.exec(`ALTER TABLE watchlist ADD COLUMN source TEXT DEFAULT 'MANUAL'`); } catch(e) {}

    const count = await db.get(`SELECT COUNT(*) as c FROM watchlist`);
    if (count.c === 0) {
        const defaultList = ["AAPL", "NVDA", "TSLA", "ARM", "PLTR", "IONQ", "MSTR", "AMD", "GOOGL", "PYPL", "BAYN.DE"];
        for (const sym of defaultList) { await db.run(`INSERT INTO watchlist (symbol, source) VALUES (?, 'MANUAL')`, sym); }
    }
    console.log("💾 SQLite Memory Core (Dual-Origin) geladen.");
}
initDB().catch(console.error);

// ============================================================================
// 🔥 DER REGEX PARSER FÜR DEN TÄGLICHEN ELLIOTT REPORT
// ============================================================================
function extractTickersFromReport(text: string): string[] {
    const lines = text.split('\n');
    const found: string[] = [];
    // Sucht am Zeilenanfang nach 2-8 Großbuchstaben/Zahlen/Punkten, gefolgt von Leerzeichen & einer Ziffer/Minus
    const tickerRegex = /^([A-Z0-9.\-]{2,8})\s+[-]?\d/;
    
    for (const l of lines) {
        const m = l.trim().match(tickerRegex);
        if (m) {
            const sym = m[1].trim();
            if (!['CRV', 'OSC', 'EXP', 'AUSBR', 'KORR', 'TK', 'EW'].includes(sym)) {
                found.push(sym);
            }
        }
    }
    return Array.from(new Set(found));
}

async function runRadarScan(targetChatId: number) {
  const rows = await db.all(`SELECT symbol FROM watchlist`);
  if (rows.length === 0) {
      await bot.telegram.sendMessage(targetChatId, "❌ Automatischer Scan abgebrochen: Watchlist leer.");
      return;
  }

  console.log(`[CRON] Starte autonomen Radar-Scan für ${rows.length} Assets...`);
  let hits = 0; let mutedCount = 0;
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

  for (const row of rows) {
      const sym = row.symbol;
      try {
          const record = await db.get(`SELECT last_alert_timestamp FROM alerts WHERE symbol = ?`, sym);
          if (record && (now - record.last_alert_timestamp) < SEVEN_DAYS_MS) { mutedCount++; continue; }

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

  if (hits === 0) {
      await bot.telegram.sendMessage(targetChatId, `🏁 **SCAN ABGESCHLOSSEN**\n\n• Radar-Watchlist: \`${rows.length}\` Werte\n• Neue Treffer: \`0\`\n• Durch 7d-Maulkorb blockiert: \`${mutedCount}\`\n\n*(Keine neue Aktie befindet sich in der Macro Kill-Zone).*`);
  } else {
      await bot.telegram.sendMessage(targetChatId, `🏁 **RADAR-DURCHLAUF BEENDET** (Neue Hits: ${hits})`);
  }
}

cron.schedule("15 22 * * *", async () => {
    if (activeChatId) await runRadarScan(activeChatId);
});

// ============================================================================
// 🔥 TEXT MIDDLEWARE (Fängt den täglichen Report ab)
// ============================================================================
bot.on("text", async (ctx, next) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return next(); 

    if (text.includes("Elliott 1-2 Screen") || text.includes("Third-of-a-Third") || text.includes("Universum:")) {
        activeChatId = ctx.chat.id;
        const parsedTickers = extractTickersFromReport(text);
        
        if (parsedTickers.length === 0) {
            return ctx.reply("⚠️ Screen-Report erkannt, aber es konnten keine validen Ticker extrahiert werden.");
        }

        const oldScreenRows = await db.all(`SELECT symbol FROM watchlist WHERE source = 'SCREEN'`);
        const oldSet = new Set(oldScreenRows.map(r => r.symbol));
        const newSet = new Set(parsedTickers);

        const toAdd = parsedTickers.filter(x => !oldSet.has(x));
        const toRemove = Array.from(oldSet).filter(x => !newSet.has(x));

        // 1. Alte Screen-Werte löschen (Manuelle bleiben unberührt!)
        for (const sym of toRemove) await db.run(`DELETE FROM watchlist WHERE symbol = ? AND source = 'SCREEN'`, sym);
        
        // 2. Neue Screen-Werte eintragen
        for (const sym of parsedTickers) await db.run(`INSERT OR IGNORE INTO watchlist (symbol, source) VALUES (?, 'SCREEN')`, sym);

        const total = await db.get(`SELECT COUNT(*) as c FROM watchlist`);
        const manualCount = await db.get(`SELECT COUNT(*) as c FROM watchlist WHERE source = 'MANUAL'`);

        await ctx.reply(
            `📥 **SCREEN-REPORT SYNCHRONISIERT**\n\n` +
            `• Im Report erkannt: \`${parsedTickers.length}\` Ticker\n` +
            `• Frische Kandidaten: \`+${toAdd.length}\` ${toAdd.length > 0 ? `*(${toAdd.slice(0, 4).join(", ")}${toAdd.length > 4 ? '...' : ''})*` : ''}\n` +
            `• Veraltete Screen-Werte gelöscht: \`-${toRemove.length}\`\n` +
            `• Deine manuellen Darlings geschützt: \`${manualCount.c}\`\n\n` +
            `📡 **Radar scharfgeschaltet: Überwacht heute Abend exakt ${total.c} Assets.**`
        );
        return;
    }
    return next();
});

// TELEGRAM COMMANDS
bot.command("add", async (ctx) => {
    activeChatId = ctx.chat.id; 
    const sym = (ctx.message.text.split(" ")[1] || "").trim().toUpperCase();
    if (!sym) return ctx.reply("❌ Symbol angeben!");
    await db.run(`INSERT OR REPLACE INTO watchlist (symbol, source) VALUES (?, 'MANUAL')`, sym);
    await ctx.reply(`✅ ${sym} (MANUAL) zur Watchlist hinzugefügt.`);
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
    const rows = await db.all(`SELECT symbol, source FROM watchlist ORDER BY source, symbol`);
    await ctx.reply(rows.length === 0 ? "📭 Watchlist leer." : `📋 **Radar-Watchlist (${rows.length}):**\n${rows.map(r => `• \`${r.symbol.padEnd(8)}\` [${r.source}]`).join("\n")}`);
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
                            
