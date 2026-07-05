import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'trading_bot.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    signal_type TEXT,
    entry_price REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    outcome REAL,
    is_success BOOLEAN
  )
`);

export default db;

