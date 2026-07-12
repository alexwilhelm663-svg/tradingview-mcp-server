import "dotenv/config";
import { Telegraf } from "telegraf";
import http from "http";
import crypto from "crypto";
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
// Wird von Render automatisch gesetzt (z.B. https://xyz.onrender.com).
// Vorhanden -> Webhook-Modus. Fehlt (lokal) -> Polling-Fallback.
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const COOLDOWN_MS = 7 * 24 * 3600 * 1000; // 7 Tage pro Symbol

console.log("🚀 EW Quant Hunter V111.1: Composition Root startet...");

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
// Hinweis Free-Tier: laeuft nur, wenn die Instanz zur vollen Stunde wach ist.
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

let server: http.Server;

async function start(): Promise<void> {
  if (EXTERNAL_URL) {
    // ── Webhook-Modus ────────────────────────────────────────────────
    // Telegram pusht Updates als eingehende POSTs -> zaehlt bei Render
    // als Traffic (weckt Free-Instanzen) und macht getUpdates-409s
    // bei Deploy-Overlaps unmoeglich.
    const secretPath =
      "/telegraf/" +
      crypto.createHash("sha256").update(token!).digest("hex").slice(0, 32);

    const handler = await bot.createWebhook({
      domain: EXTERNAL_URL,
      path: secretPath,
    });

    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === secretPath) {
        return (handler as unknown as http.RequestListener)(req, res);
      }
      // Alles andere (UptimeRobot-Pings, Render-Port-Scan, Browser) -> Health
      res.end("Bot active");
    });

    server.listen(PORT, () =>
      console.log(`🌐 Webhook-Modus aktiv auf Port ${PORT} (${EXTERNAL_URL})`)
    );
  } else {
    // ── Polling-Fallback (lokale Entwicklung) ────────────────────────
    server = http.createServer((_req, res) => res.end("Bot active"));
    server.listen(PORT, () => console.log(`🌐 Health-Server auf Port ${PORT}`));

    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    bot.launch().then(() => console.log("✅ Telegram Polling gestartet (lokaler Modus)."));
  }
}

start().catch((err: any) => {
  console.error("❌ Start-Fehler:", err?.message ?? err);
  process.exit(1);
});

// Graceful Shutdown. Der Webhook bleibt bei Telegram registriert,
// damit Updates waehrend Deploy/Spin-down gepuffert werden.
function shutdown(signal: string): void {
  console.log(`${signal} empfangen, fahre herunter...`);
  try {
    bot.stop(signal);
  } catch {
    /* im Webhook-Modus ggf. nicht gestartet */
  }
  if (server) server.close();
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
