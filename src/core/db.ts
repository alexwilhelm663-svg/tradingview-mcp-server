import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Einziger Persistenz-Punkt: /app/data (Render-Volume) bzw. ./data lokal
const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "trading_bot.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS trade_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    signal_type TEXT,
    entry_price REAL,
    invalidation REAL,
    target REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    outcome REAL,
    is_success BOOLEAN
  );
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    symbol TEXT PRIMARY KEY,
    source TEXT
  );
  CREATE TABLE IF NOT EXISTS alerts (
    symbol TEXT PRIMARY KEY,
    last_alert_timestamp INTEGER
  );
  CREATE TABLE IF NOT EXISTS setups (
    symbol TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    direction TEXT DEFAULT 'LONG',
    cluster_floor REAL,
    cluster_ceiling REAL,
    cluster_score INTEGER,
    trigger_level REAL,
    invalidation REAL,
    c_low REAL,
    levels TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migration: Spalten auf Bestands-DBs nachruesten (Fehler = Spalte existiert schon)
const tradeCols = ["invalidation REAL", "target REAL", "confidence REAL", "flags TEXT", "direction TEXT DEFAULT 'LONG'"];
for (const col of tradeCols) {
  try {
    db.exec(`ALTER TABLE trade_history ADD COLUMN ${col}`);
  } catch {
    /* Spalte vorhanden */
  }
}
for (const col of ["llm_confidence REAL", "llm_flags TEXT", "det_flags TEXT"]) {
  try {
    db.exec(`ALTER TABLE setups ADD COLUMN ${col}`);
  } catch {
    /* Spalte vorhanden */
  }
}

export default db;
