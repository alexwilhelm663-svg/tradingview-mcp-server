import db from "./db";

const DEFAULTS = ["BTC-USD", "ETH-USD", "TSLA", "AMD", "NVDA", "AAPL"];

/**
 * V157: Screener-Universum. Wird bei jedem Start per INSERT OR IGNORE
 * sichergestellt - die DB auf dem Free Tier ist nach jedem Deploy leer,
 * und die DEFAULTS greifen nur bei komplett leerer Tabelle.
 *
 * Samsung und SK hynix laufen ueber die koreanischen Primaernotierungen
 * (005930.KS / 000660.KS) - die deutschen Listings SSU.DE und HY9H.DE
 * liefern bei Yahoo keine Daten.
 */
export const SCREENER_UNIVERSE = [
  // Krypto
  "BTC-USD", "ETH-USD", "SOL-USD", "LINK-USD", "DOGE-USD",
  // Krypto-Proxies
  "COIN", "MSTR", "CRCL", "IREN",
  // Halbleiter & KI
  "NVDA", "ARM", "MU", "ALAB", "TER", "IONQ", "005930.KS", "000660.KS",
  // Software & Plattform
  "MSFT", "AMZN", "ADBE", "TEAM", "NOW", "PLTR",
  // Industrie, Rohstoffe, Konsum, Pharma
  "CAT", "HCC", "AMR", "CMG", "UAA", "NVO", "P911.DE",
];

/** Stellt sicher, dass das Screener-Universum in der Watchlist steht. */
export function ensureScreenerUniverse(): number {
  const ins = db.prepare(
    "INSERT OR IGNORE INTO watchlist (symbol, source) VALUES (?, 'SCREENER')"
  );
  let added = 0;
  for (const s of SCREENER_UNIVERSE) {
    const r = ins.run(s);
    if (r.changes > 0) added++;
  }
  return added;
}

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
