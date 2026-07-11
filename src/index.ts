import "dotenv/config";
import { Telegraf } from "telegraf";
import http from "http";
import cron from "node-cron";
import db from "./core/db";
import { analyzeAsset } from "./core/engine";
import { getWatchlist } from "./core/watchlist";
import { resolveOpenTrades } from "./core/outcome";
import { updateStatistics } from "./core/stats";
import { registerCommands } from "./bot/commands";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN ist nicht gesetzt!");

const bot = new Telegraf(token, { handlerTimeout: 9_000_000 });
const PORT = Number(process.env.PORT) || 10000;
const COOLDOWN_MS = 7 * 24 * 3600 * 1000; // 7 Tage pro Symbol

console.log("🚀 EW Quant Hunter V111: konsolidierter Composition Root startet...");

function getActiveChatId(): number | null {
  const row = db.prepare("SELECT value FROM config WHERE key = 'chat_id'").get() as
    | { value: string }
    | undefined;
  return row ? parseInt(row.value, 10) : null;
}

async function runRadarScan(targetChatId: number): Promise<void> {
  const watchlist = getWatchlist();
  console.log(`[SCAN] ${new Date().toISOString()} – ${watchlist.length} Assets...`);
  const now = Date.now();

  for (const symbol of watchlist) {
    try {
      const rec = db
        .prepare("SELECT last_alert_timestamp FROM alerts WHERE symbol = ?")
        .get(symbol) as { last_alert_timestamp: number } | undefined;
      if (rec && now - rec.last_alert_timestamp < COOLDOWN_MS) continue;

      const res = await analyzeAsset(symbol);
      if (res.signal !== "YES") continue;

      const caption = res.isBreakoutSetup
        ? `🚀 **HIT: ${symbol}**\n${res.breakoutStatus}`
        : `🎯 **HIT: ${symbol}**\n${res.killZoneStatus}`;

      db.prepare(
        "INSERT OR REPLACE INTO alerts (symbol, last_alert_timestamp) VALUES (?, ?)"
      ).run(symbol, now);

      if (res.buffer) {
        await bot.telegram.sendPhoto(
          targetChatId,
          { source: res.buffer },
          { caption, parse_mode: "Markdown" }
        );
      } else {
        await bot.telegram.sendMessage(targetChatId, caption, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      console.error(`[SCAN] Fehler bei ${symbol}:`, err?.message ?? err);
    }
  }
}

registerCommands(bot, runRadarScan);

// Stuendlicher Zyklus: erst Outcomes aufloesen, dann scannen, dann Statistik erneuern.
// Reihenfolge ist wichtig: so lernt der naechste Scan aus frisch geschlossenen Trades.
cron.schedule("0 * * * *", async () => {
  console.log("⏰ Automatischer Zyklus startet...");
  try {
    await resolveOpenTrades();
    const chatId = getActiveChatId();
    if (chatId) {
      await runRadarScan(chatId);
    } else {
      console.log("⚠️ Kein Scan: Chat-ID fehlt (einmal /start an den Bot senden).");
    }
    updateStatistics();
  } catch (err: any) {
    console.error("❌ Zyklus-Fehler:", err?.message ?? err);
  }
});

// Dummy-HTTP-Server: Render braucht einen offenen Port
const server = http.createServer((_req, res) => res.end("Bot active"));
server.listen(PORT, () => console.log(`🌐 Health-Server auf Port ${PORT}`));

bot.launch().then(() => console.log("✅ Telegram Polling gestartet."));

// Graceful Shutdown gegen 409-Konflikte bei Redeploys
process.once("SIGINT", () => {
  bot.stop("SIGINT");
  server.close();
  process.exit(0);
});
process.once("SIGTERM", () => {
  bot.stop("SIGTERM");
  server.close();
  process.exit(0);
});
