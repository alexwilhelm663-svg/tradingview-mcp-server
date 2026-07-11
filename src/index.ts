// @ts-nocheck
import { Telegraf } from "telegraf";
import http from "http";
import cron from "node-cron";
import { analyzeAsset } from "./engine";
import db from "./db";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V110.1: Hybrid Dual-Hunter (Lern-Modus aktiv)...");

// ==========================================
// 🗄️ DATENBANK-INITIALISIERUNG
// ==========================================
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS watchlist (
            symbol TEXT PRIMARY KEY,
            source TEXT
        );
        CREATE TABLE IF NOT EXISTS alerts (
            symbol TEXT PRIMARY KEY,
            last_alert_timestamp INTEGER
        );
        CREATE TABLE IF NOT EXISTS trade_history (
            symbol TEXT,
            signal_type TEXT,
            entry_price REAL
        );
    `);
    console.log("✅ Datenbank-Tabellen erfolgreich geprüft/erstellt.");
} catch (err) {
    console.error("❌ Fehler beim Initialisieren der Datenbank:", err);
}

// ==========================================
// ⚙️ HILFSFUNKTIONEN
// ==========================================
function getActiveChatId(): number | null {
    try {
        const row = db.prepare("SELECT value FROM config WHERE key = 'chat_id'").get();
        return row ? parseInt(row.value) : null;
    } catch (e) {
        console.error("Fehler beim Lesen der Chat-ID:", e);
        return null;
    }
}

function updateChatId(id: number) {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").run('chat_id', id.toString());
}

// ==========================================
// 📡 RADAR-SCAN LOGIK
// ==========================================
async function runRadarScan(targetChatId: number) {
    try {
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
            } catch (err) { 
                console.error(`Fehler bei ${row.symbol}:`, err); 
            }
        }
    } catch (error) {
        console.error("Kritischer Datenbank-Fehler im Radar-Scan:", error);
    }
}

// ==========================================
// 🤖 BOT COMMANDS
// ==========================================
bot.command('start', (ctx) => {
    try {
        updateChatId(ctx.chat.id);
        ctx.reply("✅ Bot ist aktiv und diese Chat-ID wurde für Alerts gespeichert!");
    } catch (error) {
        console.error("Datenbankfehler bei /start:", error);
        ctx.reply("❌ Fehler beim Speichern der Chat-ID. Bitte Logs prüfen.");
    }
});

bot.command('watchlist', (ctx) => {
    try {
        const rows = db.prepare("SELECT symbol FROM watchlist").all();
        if (rows.length === 0) {
            return ctx.reply("Deine Watchlist ist aktuell leer. Nutze /add <Symbol>, um etwas hinzuzufügen.");
        }
        const symbols = rows.map(r => r.symbol).join(', ');
        ctx.reply(`📋 **Aktuelle Watchlist:**\n${symbols}`);
    } catch (error) {
        console.error("Datenbankfehler bei /watchlist:", error);
        ctx.reply("❌ Fehler beim Abrufen der Watchlist.");
    }
});

bot.command('add', (ctx) => {
    try {
        const args = ctx.message.text.split(' ');
        const symbol = args[1]?.toUpperCase();
        
        if (!symbol) {
            return ctx.reply("⚠️ Bitte gib ein Symbol an. Beispiel: /add BTC-USD");
        }

        db.prepare("INSERT OR REPLACE INTO watchlist (symbol, source) VALUES (?, ?)").run(symbol, 'MANUAL');
        ctx.reply(`✅ ${symbol} wurde erfolgreich zur Watchlist hinzugefügt!`);
    } catch (error) {
        console.error("Datenbankfehler bei /add:", error);
        ctx.reply("❌ Fehler beim Hinzufügen des Symbols.");
    }
});

bot.command('analyse', async (ctx) => {
    const args = ctx.message.text.split(' ');
    const symbol = args[1]?.toUpperCase();

    if (!symbol) {
        return ctx.reply("⚠️ Bitte gib ein Symbol an. Beispiel: /analyse BTC-USD");
    }

    ctx.reply(`⏳ Starte Analyse für ${symbol}... Bitte warten.`);
    
    try {
        const res = await analyzeAsset(symbol);
        
        if (res.buffer) {
            await ctx.replyWithPhoto({ source: res.buffer }, { caption: `Analyse für ${symbol} abgeschlossen.` });
        } else {
            await ctx.reply(`Analyse für ${symbol} abgeschlossen. (Kein Chart generiert, Buffer ist leer)`);
        }
    } catch (error) {
        console.error("Fehler im /analyse Befehl:", error);
        ctx.reply(`❌ Fehler bei der Analyse von ${symbol}. Check die Render Logs.`);
    }
});

// ==========================================
// ⏰ CRON-JOB
// ==========================================
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
}).catch((err) => {
    console.error("❌ Fehler beim Bot-Launch:", err);
});

// Verhindert den 409 Conflict bei Render Deployments
process.once('SIGINT', () => {
    console.log("🛑 SIGINT empfangen. Bot wird beendet.");
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log("🛑 SIGTERM empfangen. Bot wird beendet.");
    bot.stop('SIGTERM');
    process.exit(0);
});
