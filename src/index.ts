// @ts-nocheck
import { Telegraf } from "telegraf";
import http from "http";
import cron from "node-cron";
import { analyzeAsset } from "./engine";
import db from "./db";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V110.1: Hybrid Dual-Hunter (Lern-Modus aktiv)...");

function getActiveChatId(): number | null {
    const row = db.prepare("SELECT value FROM config WHERE key = 'chat_id'").get();
    return row ? parseInt(row.value) : null;
}

function updateChatId(id: number) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run('chat_id', id.toString());
}

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

// ==========================================
// 🤖 BOT COMMANDS (Das hat komplett gefehlt!)
// ==========================================

bot.command('start', (ctx) => {
    updateChatId(ctx.chat.id);
    ctx.reply("✅ Bot ist aktiv und diese Chat-ID wurde für Alerts gespeichert!");
});

// Reagiert auf deinen Befehl im Screenshot: /watchlist
bot.command('watchlist', (ctx) => {
    const rows = db.prepare("SELECT symbol FROM watchlist").all();
    if (rows.length === 0) {
        return ctx.reply("Deine Watchlist ist aktuell leer.");
    }
    const symbols = rows.map(r => r.symbol).join(', ');
    ctx.reply(`📋 **Aktuelle Watchlist:**\n${symbols}`);
});

// Reagiert auf deinen Befehl im Screenshot: /analyse btc-usd
bot.command('analyse', async (ctx) => {
    // Schneidet den Text nach "/analyse " aus (z.B. "btc-usd")
    const args = ctx.message.text.split(' ');
    const symbol = args[1]?.toUpperCase();

    if (!symbol) {
        return ctx.reply("⚠️ Bitte gib ein Symbol an. Beispiel: /analyse BTC-USD");
    }

    ctx.reply(`⏳ Starte Analyse für ${symbol}... Bitte warten.`);
    
    try {
        // Hier rufst du deine Engine auf
        const res = await analyzeAsset(symbol);
        
        // Simples Feedback an dich
        if (res.buffer) {
            await ctx.replyWithPhoto({ source: res.buffer }, { caption: `Analyse für ${symbol} abgeschlossen.` });
        } else {
            await ctx.reply(`Analyse für ${symbol} abgeschlossen. (Kein Chart generiert)`);
        }
    } catch (error) {
        console.error(error);
        ctx.reply(`❌ Fehler bei der Analyse von ${symbol}. Check die Render Logs.`);
    }
});


// ==========================================
// ⏰ CRON-JOB (Damit runRadarScan auch mal startet)
// ==========================================

// Läuft aktuell als Beispiel alle 60 Minuten. (Format: Minute Stunde Tag Monat Wochentag)
cron.schedule('0 * * * *', async () => {
    console.log("⏰ Starte automatischen Radar-Scan...");
    const chatId = getActiveChatId();
    if (chatId) {
        await runRadarScan(chatId);
    } else {
        console.log("⚠️ Kein Radar-Scan: Es wurde noch keine Chat-ID per /start gesetzt.");
    }
});


// ==========================================
// 🌐 SERVER & START & CRASH-SCHUTZ
// ==========================================

const server = http.createServer((req, res) => res.end("Bot active"));
server.listen(PORT, () => console.log(`Server läuft auf Port ${PORT}`));

bot.launch().then(() => {
    console.log("✅ Telegram Polling erfolgreich gestartet.");
});

// Verhindert den "409 Conflict" Absturz beim nächsten Render-Deploy
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
