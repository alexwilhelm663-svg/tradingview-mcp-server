import fs from "fs";
import path from "path";

const RADAR_FILE = path.join(__dirname, "radar_watchlist.json");

export function getRadarWatchlist(): string[] {
  if (!fs.existsSync(RADAR_FILE)) {
    // Standard-Watchlist anlegen, falls die Datei noch nicht existiert
    const defaultList = ["BTC-USD", "ETH-USD", "TSLA", "AMD", "NVDA", "AAPL"];
    saveRadarWatchlist(defaultList);
    return defaultList;
  }
  try {
    const data = JSON.parse(fs.readFileSync(RADAR_FILE, "utf-8"));
    if (Array.isArray(data)) return data;
    if (data.assets && Array.isArray(data.assets)) return data.assets;
    return [];
  } catch (e) {
    console.error("[FEHLER] Konnte radar_watchlist.json nicht lesen:", e);
    return [];
  }
}

export function saveRadarWatchlist(watchlist: string[]): void {
  const uniqueList = Array.from(new Set(watchlist.map(s => s.trim().toUpperCase()))).sort();
  fs.writeFileSync(RADAR_FILE, JSON.stringify(uniqueList, null, 2), "utf-8");
}

export function addToRadar(symbol: string): string {
  const cleanSymbol = symbol.trim().toUpperCase();
  const watchlist = getRadarWatchlist();
  
  if (watchlist.includes(cleanSymbol)) {
    return `⚠️ **${cleanSymbol}** befindet sich bereits auf dem Radar.`;
  }
  
  watchlist.push(cleanSymbol);
  saveRadarWatchlist(watchlist);
  return `✅ **${cleanSymbol}** wurde zum Radar hinzugefügt!`;
}

export function removeFromRadar(symbol: string): string {
  const cleanSymbol = symbol.trim().toUpperCase();
  let watchlist = getRadarWatchlist();
  
  if (!watchlist.includes(cleanSymbol)) {
    return `⚠️ **${cleanSymbol}** wurde nicht auf dem Radar gefunden.`;
  }
  
  watchlist = watchlist.filter(item => item !== cleanSymbol);
  saveRadarWatchlist(watchlist);
  return `🗑️ **${cleanSymbol}** wurde vom Radar entfernt.`;
}

export function viewRadar(): string {
  const watchlist = getRadarWatchlist();
  if (watchlist.length === 0) return "📡 Das Radar ist aktuell leer.";
  return `📡 **Aktives Radar (${watchlist.length} Assets):**\n` + watchlist.join(", ");
}

