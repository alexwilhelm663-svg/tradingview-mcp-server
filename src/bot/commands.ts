import { Telegraf } from "telegraf";
import { analyzeAsset } from "../core/engine";
import { addToWatchlist, removeFromWatchlist, viewWatchlist } from "../core/watchlist";
import { listSetups } from "../core/setups";
import db from "../core/db";

// In-Flight-Sperren: verhindern parallele Laeufe desselben Auftrags
// (z.B. durch doppelt zugestellte Updates oder ungeduldige Nutzer).
const analysesInFlight = new Set<string>();
let scanInFlight = false;

/**
 * Registriert alle Bot-Commands am uebergebenen Telegraf-Objekt.
 * runScan wird vom Composition Root (index.ts) injiziert, damit /scan
 * und der Cron-Zyklus exakt dieselbe Logik nutzen.
 */
export function registerCommands(
  bot: Telegraf,
  runScan: (chatId: number) => Promise<void>
): void {
  bot.command("start", (ctx) => {
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('chat_id', ?)").run(
      String(ctx.chat.id)
    );
    return ctx.reply(
      "🤖 **ElliotEugen Trading Bot bereit.**\n\n" +
        "• `/radar` – aktuelle Watchlist\n" +
        "• `/add <SYMBOL>` – Asset hinzufügen\n" +
        "• `/remove <SYMBOL>` – Asset entfernen\n" +
        "• `/analyse <SYMBOL>` – sofortige EW-Analyse mit Chart\n" +
        "• `/setups` – Setup-Status (PENDING/CONFIRMED)\n" +
        "• `/scan` – manueller Radar-Durchlauf\n\n" +
        "✅ Chat-ID für automatische Alerts gespeichert.",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("radar", (ctx) => ctx.reply(viewWatchlist(), { parse_mode: "Markdown" }));
  bot.command("setups", (ctx) => ctx.reply(listSetups(), { parse_mode: "Markdown" }));
  bot.command("watchlist", (ctx) => ctx.reply(viewWatchlist(), { parse_mode: "Markdown" }));

  bot.command("add", (ctx) => {
    const arg = ctx.message.text.split(" ")[1];
    if (!arg) {
      return ctx.reply("⚠️ Bitte Symbol angeben: `/add BTC-USD`", { parse_mode: "Markdown" });
    }
    return ctx.reply(addToWatchlist(arg), { parse_mode: "Markdown" });
  });

  bot.command("remove", (ctx) => {
    const arg = ctx.message.text.split(" ")[1];
    if (!arg) {
      return ctx.reply("⚠️ Bitte Symbol angeben: `/remove TSLA`", { parse_mode: "Markdown" });
    }
    return ctx.reply(removeFromWatchlist(arg), { parse_mode: "Markdown" });
  });

  bot.command("scan", async (ctx) => {
    if (scanInFlight) {
      return ctx.reply("⏳ Ein Radar-Scan läuft bereits – bitte warten.");
    }
    scanInFlight = true;
    try {
      await ctx.reply("⚙️ Starte manuellen Radar-Scan...");
      await runScan(ctx.chat.id);
      await ctx.reply("✅ Radar-Scan abgeschlossen!");
    } finally {
      scanInFlight = false;
    }
  });

  bot.command("analyse", async (ctx) => {
    const arg = ctx.message.text.split(" ")[1];
    if (!arg) {
      return ctx.reply("⚠️ Bitte Symbol angeben: `/analyse NVDA`", { parse_mode: "Markdown" });
    }
    const symbol = arg.trim().toUpperCase();

    const key = `${ctx.chat.id}:${symbol}`;
    if (analysesInFlight.has(key)) {
      return ctx.reply(
        `⏳ Analyse für **${symbol}** läuft bereits – das Ergebnis kommt gleich.`,
        { parse_mode: "Markdown" }
      );
    }
    analysesInFlight.add(key);

    const status = await ctx.reply(`🔄 Analysiere **${symbol}** nach Elliott-Wellen...`, {
      parse_mode: "Markdown",
    });

    try {
      const r = await analyzeAsset(symbol);

      if (!r.analysis) {
        await ctx.reply(
          `⚠️ Für **${symbol}** war keine valide Analyse möglich (Daten- oder Validierungsfehler). Details stehen im Server-Log.`,
          { parse_mode: "Markdown" }
        );
        return;
      }

      let caption = `📊 **EW Master Analyse: ${symbol}**\nMakro-Trend: \`${r.finalTrend}\`\n\n`;
      if (r.clusterInfo) caption += `${r.clusterInfo}\n`;
      if (r.isBreakoutSetup) caption += `${r.breakoutStatus}\n`;
      if (!r.clusterInfo && !r.isBreakoutSetup) caption += "⚪ Aktuell in keiner Trigger-Zone.";
      if (r.analysis.analysis) {
        const info = r.analysis.analysis.length > 450
          ? r.analysis.analysis.slice(0, 447) + "..."
          : r.analysis.analysis;
        caption += `\n\n${info}`;
      }

      if (r.buffer) {
        await ctx.replyWithPhoto({ source: r.buffer }, { caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(caption, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Fehler bei ${symbol}: \`${err?.message ?? err}\``, {
        parse_mode: "Markdown",
      });
    } finally {
      analysesInFlight.delete(key);
      ctx.deleteMessage(status.message_id).catch(() => {});
    }
  });
}
