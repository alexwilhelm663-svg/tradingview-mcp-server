// @ts-nocheck
import { Telegraf } from "telegraf";
import http from "http";
import cron from "node-cron";
import { analyzeAsset } from "./engine";
import db from "./db"; // NEU: Importiere deine zentrale DB-Instanz

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V110.1: Hybrid Dual-Hunter (Lern-Modus aktiv)...");

// Funktion zum Laden/Speichern von Konfigurationen (da db jetzt synchron arbeitet)
function getActiveChatId(): number | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'chat_id'").get();
    return row ? parseInt(row.value) : null;
}

function updateChatId(id: number) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run('chat_id', id.toString());
}

// Radar-Scan Logik angepasst an den synchronen Zugriff
async function runRadarScan(targetChatId: number) {
  const rows = db.prepare("SELECT symbol, source FROM watchlist").all();
  if (rows.length === 0) return;

  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;

  for (const row of rows) {
      try {
          const record = db.prepare("SELECT last_alert_timestamp FROM alerts WHERE symbol = ?").get(row.symbol);
          if (record && (now - record.last_alert_timestamp) < SEVEN_DAYS_MS) continue;

          const res = await analyzeAsset(row.symbol);
          
          if (res.signal === "YES") {
              if (res.isHotSetup || (res.isBreakoutSetup && row.source === 'SCREEN')) {
                  const msgCaption = res.isHotSetup ? `🎯 **HIT: ${row.symbol}**\n${res.killZoneStatus}` : `🚀 **HIT: ${row.symbol}**\n${res.breakoutStatus}`;
                  
                  db.prepare("INSERT OR REPLACE INTO alerts (symbol, last_alert_timestamp) VALUES (?, ?)").run(row.symbol, now);
                  
                  if (res.buffer) {
                      await bot.telegram.sendPhoto(targetChatId, { source: res.buffer }, { caption: msgCaption });
                  } else {
                      await bot.telegram.sendMessage(targetChatId, msgCaption);
                  }
              }
          }
      } catch (err) { console.error(`Fehler bei ${row.symbol}:`, err); }
  }
}

// Bot Events
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/start')) updateChatId(ctx.chat.id);
});

// Server & Start
const server = http.createServer((req, res) => res.end("Bot active"));
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));
bot.launch();
