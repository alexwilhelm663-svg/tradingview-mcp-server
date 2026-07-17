import "dotenv/config";
import { Telegraf } from "telegraf";
import http from "http";
import crypto from "crypto";
import cron from "node-cron";
import db from "./core/db";
import { analyzeAsset } from "./core/engine";
import { getWatchlist } from "./core/watchlist";
import { resolveOpenTrades } from "./core/outcome";
import { resolvePendingSetups } from "./core/setups";
import { updateStatistics } from "./core/stats";
import { registerCommands } from "./bot/commands";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN ist nicht gesetzt!");

const bot = new Telegraf(token, { handlerTimeout: 9_000_000 });
const PORT = Number(process.env.PORT) || 10000;
// Wird von Render automatisch gesetzt. Vorhanden -> Webhook, sonst Polling (lokal).
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const COOLDOWN_MS = 7 * 24 * 3600 * 1000; // 7 Tage pro Symbol

console.log("🚀 EW Quant Hunter V117.1: EW-Engine (Best-über-Stufen, GL-1 generalisiert) startet...");

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
        : `🟡 **NEUES SETUP: ${symbol}**\n${res.clusterInfo}`;

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
    // Free-Tier-RPM schonen (Gemini-Quota gilt pro Minute UND pro Tag)
    await new Promise((r) => setTimeout(r, 5000));
  }
}

registerCommands(bot, runRadarScan);

// Stuendlicher Zyklus: Outcomes aufloesen -> scannen -> Statistik erneuern.
cron.schedule("0 * * * *", async () => {
  console.log("⏰ Automatischer Zyklus startet...");
  try {
    await resolveOpenTrades();
    const chatId = getActiveChatId();
    const setupEvents = await resolvePendingSetups();
    if (chatId) {
      for (const ev of setupEvents) {
        await bot.telegram.sendMessage(chatId, ev.text, { parse_mode: "Markdown" }).catch(() => {});
      }
      await runRadarScan(chatId);
    } else {
      console.log("⚠️ Kein Scan: Chat-ID fehlt (einmal /start an den Bot senden).");
    }
    updateStatistics();
  } catch (err: any) {
    console.error("❌ Zyklus-Fehler:", err?.message ?? err);
  }
});

// ── Update-Deduplizierung ────────────────────────────────────────────
// Telegram liefert Updates erneut, wenn kein rechtzeitiges 200 kommt
// (z.B. waehrend Deploys/Cold-Starts). update_ids sind monoton steigend;
// ein kleines Sliding-Window-Set reicht als Duplikat-Filter.
const seenUpdates = new Set<number>();
const SEEN_LIMIT = 1000;

function isNewUpdate(id: number): boolean {
  if (seenUpdates.has(id)) return false;
  seenUpdates.add(id);
  if (seenUpdates.size > SEEN_LIMIT) {
    const oldest = seenUpdates.values().next().value;
    if (oldest !== undefined) seenUpdates.delete(oldest);
  }
  return true;
}

let server: http.Server;

async function start(): Promise<void> {
  if (EXTERNAL_URL) {
    // ── Webhook-Modus mit Sofort-ACK ─────────────────────────────────
    // KRITISCH: Telegram erwartet binnen Sekunden ein 200. Handler wie
    // /analyse laufen aber minutenlang. Deshalb: Update entgegennehmen,
    // SOFORT bestaetigen, dann asynchron verarbeiten. Sonst liefert
    // Telegram dasselbe Update endlos neu (Analyse-Schleife!).
    const secretPath =
      "/telegraf/" +
      crypto.createHash("sha256").update(token!).digest("hex").slice(0, 32);

    // botInfo explizit setzen, da wir handleUpdate() direkt aufrufen
    // (normalerweise erledigt das bot.launch()).
    bot.botInfo = await bot.telegram.getMe();
    await bot.telegram.setWebhook(`${EXTERNAL_URL}${secretPath}`);

    server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === secretPath) {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          // 1. Sofort quittieren -> keine Telegram-Retries
          res.statusCode = 200;
          res.end();

          // 2. Danach asynchron verarbeiten
          let update: any;
          try {
            update = JSON.parse(body);
          } catch {
            console.error("[WEBHOOK] Ungueltiger Request-Body verworfen.");
            return;
          }
          if (typeof update?.update_id === "number" && !isNewUpdate(update.update_id)) {
            console.log(`[WEBHOOK] Duplikat verworfen: update_id ${update.update_id}`);
            return;
          }
          bot
            .handleUpdate(update)
            .catch((err: any) =>
              console.error("[WEBHOOK] Update-Fehler:", err?.message ?? err)
            );
        });
        return;
      }
      // Alles andere (Pings, Port-Scan, Browser) -> Health-Antwort
      res.end("Bot active");
    });

    server.listen(PORT, () =>
      console.log(`🌐 Webhook-Modus (Sofort-ACK) aktiv auf Port ${PORT} (${EXTERNAL_URL})`)
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

// Graceful Shutdown. Der Webhook bleibt registriert, damit Telegram
// Updates waehrend Deploy/Spin-down puffert und nachliefert.
function shutdown(signal: string): void {
  console.log(`${signal} empfangen, fahre herunter...`);
  try {
    bot.stop(signal);
  } catch {
    /* im Webhook-Modus nicht gestartet */
  }
  if (server) server.close();
  process.exit(0);
}
process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
