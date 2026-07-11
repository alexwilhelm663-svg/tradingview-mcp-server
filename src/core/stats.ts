import db from "./db";
import fs from "fs";
import path from "path";

/** Schreibt die OKF-Erfolgsbilanz nach knowledge/statistics/winrates.md. */
export function updateStatistics(): void {
  const trades = db
    .prepare("SELECT * FROM trade_history WHERE is_success IS NOT NULL")
    .all() as any[];
  const total = trades.length;
  const wins = trades.filter((t) => t.is_success === 1).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(2) : "0";

  const byType = (type: string): string => {
    const sub = trades.filter((t) => t.signal_type === type);
    if (sub.length === 0) return "keine Daten";
    const w = sub.filter((t) => t.is_success === 1).length;
    return `${((w / sub.length) * 100).toFixed(0)}% (${w}/${sub.length})`;
  };

  const report = `---
type: performance_stats
last_updated: ${new Date().toISOString()}
---
# Setup Erfolgsbilanz
- Abgeschlossene Signale: ${total}
- Gesamt-Trefferquote: ${winRate}%
- HOT-Setups (Kill-Zone): ${byType("HOT")}
- BREAKOUT-Setups (Welle 3): ${byType("BREAKOUT")}
- Status: ${Number(winRate) > 70 ? "OPTIMIERT" : "LERNPHASE"}`;

  const dir = path.join(process.cwd(), "knowledge/statistics");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "winrates.md"), report);
  console.log("📈 OKF Statistik-Update geschrieben.");
}
