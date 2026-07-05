import db from './db';
import fs from 'fs';
import path from 'path';

export function updateStatistics() {
  const trades = db.prepare("SELECT * FROM trade_history WHERE is_success IS NOT NULL").all() as any[];
  const total = trades.length;
  const wins = trades.filter(t => t.is_success === 1).length;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(2) : 0;

  const report = `---
type: performance_stats
last_updated: ${new Date().toISOString()}
---
# Setup Erfolgsbilanz
- Gesamt-Analysen: ${total}
- Erfolgsquote: ${winRate}%
- Status: ${Number(winRate) > 70 ? "OPTIMIERT" : "LERNPHASE"}`;

  fs.writeFileSync(path.join(process.cwd(), 'knowledge/statistics/winrates.md'), report);
  console.log("📈 OKF Statistik-Update geschrieben.");
}

