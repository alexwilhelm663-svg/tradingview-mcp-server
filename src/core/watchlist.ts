import db from "./db";

const DEFAULTS = ["BTC-USD", "ETH-USD", "TSLA", "AMD", "NVDA", "AAPL"];

/** Liefert die Watchlist; leere DB wird einmalig mit Defaults befuellt. */
export function getWatchlist(): string[] {
  const rows = db
    .prepare("SELECT symbol FROM watchlist ORDER BY symbol")
    .all() as { symbol: string }[];

  if (rows.length === 0) {
    const ins = db.prepare(
      "INSERT OR IGNORE INTO watchlist (symbol, source) VALUES (?, 'DEFAULT')"
    );
    for (const s of DEFAULTS) ins.run(s);
    return [...DEFAULTS].sort();
  }
  return rows.map((r) => r.symbol);
}

export function addToWatchlist(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const exists = db.prepare("SELECT 1 FROM watchlist WHERE symbol = ?").get(s);
  if (exists) return `⚠️ **${s}** befindet sich bereits auf dem Radar.`;
  db.prepare("INSERT INTO watchlist (symbol, source) VALUES (?, 'MANUAL')").run(s);
  return `✅ **${s}** wurde zum Radar hinzugefügt!`;
}

export function removeFromWatchlist(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  const res = db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(s);
  return res.changes > 0
    ? `🗑️ **${s}** wurde vom Radar entfernt.`
    : `⚠️ **${s}** wurde nicht auf dem Radar gefunden.`;
}

export function viewWatchlist(): string {
  const list = getWatchlist();
  if (list.length === 0) return "📡 Das Radar ist aktuell leer.";
  return `📡 **Aktives Radar (${list.length} Assets):**\n` + list.join(", ");
}
