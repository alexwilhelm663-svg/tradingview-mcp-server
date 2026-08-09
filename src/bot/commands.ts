import { Telegraf } from "telegraf";
import { analyzeAsset } from "../core/engine";
import { buildCaption, buildDetails } from "../core/reportText";
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
let screenerInFlight = false;

/** Telegram begrenzt auf 4096 Zeichen - an Absaetzen trennen. */
export function splitMessage(text: string, limit = 3800): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let cur = "";
  for (const block of text.split("\n\n")) {
    if (cur.length + block.length + 2 > limit && cur) { parts.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + block;
  }
  if (cur) parts.push(cur);
  return parts;
}

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
        "• `/analyse <SYMBOL> [1d|1w] [1y|5y|10y|max]` – EW-Analyse; Intervall & Fenster optional\n" +
        "• `/setups` – Setup-Status (PENDING/CONFIRMED)\n" +
        "• `/scan` – manueller Radar-Durchlauf\n" +
        "• `/screener` – Unterstützungs-Status aller Titel (täglich 08:00)\n" +
        "• `/setup <SYMBOL> [30m|1h]` – 1-2-Struktur als eigener Chart\n" +
        "• `/deep <SYMBOL>` – Analyse-Tafel mit Zielzonen und Projektion\n" +
        "• `/scan12 [1h|30m|1d]` – 1-2-Strukturen über alle Titel\n\n" +
        "✅ Chat-ID für automatische Alerts gespeichert.",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("radar", (ctx) => ctx.reply(viewWatchlist(), { parse_mode: "Markdown" }));

  // V168: 1-2-Suche ueber die Watchlist, Aufloesung waehlbar.
  bot.command("scan12", async (ctx) => {
    const parts = (ctx.message as any)?.text?.trim().split(/\s+/) ?? [];
    const iv = (parts[1] || "1d").toLowerCase();
    if (!["1h", "30m", "1d", "1wk"].includes(iv)) {
      return ctx.reply("Nutzung: `/scan12 [1h|30m|1d|1wk]`", { parse_mode: "Markdown" });
    }
    if (scanInFlight) return ctx.reply("⏳ Ein Scan läuft bereits.");
    scanInFlight = true;
    try {
      await ctx.reply(`🔎 Suche 1-2-Strukturen auf ${iv}…`);
      const { scanStructures, formatScan } = await import("../core/structureScan");
      const { getWatchlist, ensureScreenerUniverse } = await import("../core/watchlist");
      ensureScreenerUniverse();
      const list = getWatchlist();
      const hits = await scanStructures(iv, list);
      for (const part of splitMessage(formatScan(hits, iv, list.length))) {
        await ctx.reply(part, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Scan-Fehler: ${err?.message ?? err}`);
    } finally {
      scanInFlight = false;
    }
  });

  // V165: Analyse-Tafel - alles in einem Bild, wenig Text darunter.
  bot.command("deep", async (ctx) => {
    const parts = (ctx.message as any)?.text?.trim().split(/\s+/) ?? [];
    const symbol = (parts[1] || "").toUpperCase();
    if (!symbol) return ctx.reply("Nutzung: `/deep SYMBOL [5y|max|1y] [1wk|1d]`", { parse_mode: "Markdown" });
    const rng = (parts[2] || "5y").toLowerCase();
    const iv = (parts[3] || "1wk").toLowerCase();
    try {
      await ctx.reply(`📐 Analyse-Tafel ${symbol}…`);
      const { buildDeepChart } = await import("../core/deepChart");
      const res = await buildDeepChart(symbol, rng, iv);
      if (res.buffer) {
        await ctx.replyWithPhoto({ source: res.buffer }, { caption: res.caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(res.caption, { parse_mode: "Markdown" });
      }
      // V167: Korrektur-Detail direkt darunter - Binnenzaehlung je Bein und
      // die Frage, ob die Korrektur noch weiterlaufen kann.
      try {
        const { buildCorrectionChart } = await import("../core/correctionChart");
        const cd = await buildCorrectionChart(symbol, rng, iv);
        if (cd.buffer) {
          await ctx.replyWithPhoto({ source: cd.buffer }, { caption: cd.caption, parse_mode: "Markdown" });
        }
      } catch {
        /* Korrektur-Detail ist optional */
      }
    } catch (err: any) {
      await ctx.reply(`❌ Tafel-Fehler: ${err?.message ?? err}`);
    }
  });

  // V161: Setup-Chart - 1-2-Struktur auf 30-Minuten-Basis, eigenes Bild.
  bot.command("setup", async (ctx) => {
    const parts = (ctx.message as any)?.text?.trim().split(/\s+/) ?? [];
    const symbol = (parts[1] || "").toUpperCase();
    if (!symbol) return ctx.reply("Nutzung: `/setup SYMBOL [30m|1h] [60d|1mo]`", { parse_mode: "Markdown" });
    const iv = (parts[2] || "30m").toLowerCase();
    const rng = (parts[3] || "60d").toLowerCase();
    try {
      await ctx.reply(`🔍 Setup-Chart ${symbol} (${iv})…`);
      const { buildSetupChart } = await import("../core/setupChart");
      const res = await buildSetupChart(symbol, iv, rng);
      if (res.buffer) {
        await ctx.replyWithPhoto({ source: res.buffer }, { caption: res.caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(res.caption, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Setup-Fehler: ${err?.message ?? err}`);
    }
  });

  // V157: Unterstuetzungs-Screener - eine Nachricht, kein Bild, kein LLM.
  bot.command("screener", async (ctx) => {
    if (screenerInFlight) return ctx.reply("⏳ Screener läuft bereits – bitte warten.");
    screenerInFlight = true;
    try {
      await ctx.reply("🛰️ Screener startet…");
      const { runScreener, formatDigest } = await import("../core/screener");
      const { ensureScreenerUniverse } = await import("../core/watchlist");
      ensureScreenerUniverse();
      const rows = await runScreener();
      for (const part of splitMessage(formatDigest(rows))) {
        await ctx.reply(part, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      await ctx.reply(`❌ Screener-Fehler: ${err?.message ?? err}`);
    } finally {
      screenerInFlight = false;
    }
  });
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
    const parts = ctx.message.text.split(" ");
    const arg = parts[1];
    if (!arg) {
      return ctx.reply("⚠️ Bitte Symbol angeben: `/analyse NVDA [5y|10y|max]`", { parse_mode: "Markdown" });
    }
    const symbol = arg.trim().toUpperCase();
    // V129: zweites Argument kann Intervall (1d/1w) ODER Range (5y/10y/max) sein.
    const arg2 = (parts[2] || "").toLowerCase();
    const arg3 = (parts[3] || "").toLowerCase();
    const tokens = [arg2, arg3];
    // V141: Kurzmodus ist Standard. "detail" (oder "voll") schaltet alles frei.
    const wantDetail = parts
      .slice(2)
      .some((x) => ["detail", "voll", "full", "alles"].includes((x || "").toLowerCase()));
    const isDaily = tokens.some((x) => ["1d", "d", "day", "daily", "tag"].includes(x));
    const rangeTok = tokens.find((x) => ["1y", "2y", "5y", "10y", "max"].includes(x));
    const interval = isDaily ? "1d" : "1wk";
    // Tageskerzen: kürzere Default-Range (sonst unlesbar viele Kerzen)
    const range = rangeTok || (isDaily ? "1y" : "5y");

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
      const r = await analyzeAsset(symbol, range, interval, wantDetail);

      if (!r.analysis) {
        if (r.abstention) {
          const caption = `🔍 **${symbol}** – Enthaltung (DK-7)\n${r.abstention}`;
          if (r.buffer) {
            await ctx.replyWithPhoto({ source: r.buffer }, { caption, parse_mode: "Markdown" });
          } else {
            await ctx.reply(caption, { parse_mode: "Markdown" });
          }
        } else {
          await ctx.reply(
            `⚠️ Für **${symbol}** war keine valide Analyse möglich (Daten- oder Validierungsfehler). Details stehen im Server-Log.`,
            { parse_mode: "Markdown" }
          );
        }
        return;
      }

      // V122 (MCO-Struktur): 1) Big Picture am Chart, 2) Details separat.
      // V162: gemeinsame Textquelle mit `npm run report` und der
      // Snapshot-Pruefung - sonst testet der Snapshot etwas anderes als das,
      // was hier ankommt.
      let caption = buildCaption(symbol, isDaily, range, r);
      if (caption.length > 1000) caption = caption.slice(0, 990) + "…";

      if (r.buffer) {
        await ctx.replyWithPhoto({ source: r.buffer }, { caption, parse_mode: "Markdown" });
      } else {
        await ctx.reply(caption, { parse_mode: "Markdown" });
      }

      const details = buildDetails(r);
      if (wantDetail) await ctx.reply(details, { parse_mode: "Markdown" });
      // V122: Detail-Chart standardmäßig entfernt (auf Wunsch reaktivierbar).

      // LLM-Kommentar separat: kein Caption-Limit, kein Abschneiden
      if (r.commentary) {
        const note = r.commentary.length > 3900 ? r.commentary.slice(0, 3897) + "..." : r.commentary;
        await ctx.reply(`💬 ${note}`);
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
