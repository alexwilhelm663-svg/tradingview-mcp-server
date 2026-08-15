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
    is_success BOOLEAN,
    signal_id TEXT,
    snapshot_id TEXT,
    entry_at TEXT,
    resolved_at TEXT,
    resolution TEXT,
    data_hash TEXT,
    engine_version TEXT
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
  CREATE TABLE IF NOT EXISTS signal_snapshots (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    as_of TEXT NOT NULL,
    data_hash TEXT NOT NULL,
    data_provider TEXT NOT NULL,
    adjustment TEXT NOT NULL,
    engine_version TEXT NOT NULL,
    interval TEXT NOT NULL,
    range_name TEXT NOT NULL,
    count_json TEXT NOT NULL,
    cluster_floor REAL NOT NULL,
    cluster_ceiling REAL NOT NULL,
    cluster_score INTEGER NOT NULL,
    cluster_evidence_count INTEGER NOT NULL,
    cluster_families TEXT NOT NULL,
    levels TEXT NOT NULL,
    trigger_level REAL NOT NULL,
    invalidation REAL NOT NULL,
    c_extreme REAL NOT NULL,
    llm_confidence REAL,
    llm_flags TEXT NOT NULL,
    det_flags TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(symbol, direction, as_of, data_hash, engine_version)
  );
  CREATE TABLE IF NOT EXISTS setup_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    effective_at TEXT NOT NULL,
    payload TEXT NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_id, event_type, effective_at)
  );
`);

// Migration: Spalten auf Bestands-DBs nachruesten (Fehler = Spalte existiert schon)
const tradeCols = [
  "invalidation REAL",
  "target REAL",
  "confidence REAL",
  "flags TEXT",
  "direction TEXT DEFAULT 'LONG'",
  "signal_id TEXT",
  "snapshot_id TEXT",
  "entry_at TEXT",
  "resolved_at TEXT",
  "resolution TEXT",
  "data_hash TEXT",
  "engine_version TEXT",
];
for (const col of tradeCols) {
  try {
    db.exec(`ALTER TABLE trade_history ADD COLUMN ${col}`);
  } catch {
    /* Spalte vorhanden */
  }
}
for (const col of [
  "llm_confidence REAL",
  "llm_flags TEXT",
  "det_flags TEXT",
  "snapshot_id TEXT",
  "as_of TEXT",
  "data_hash TEXT",
  "engine_version TEXT",
  "count_json TEXT",
  "interval_name TEXT",
  "range_name TEXT",
  "last_evaluated_bar TEXT",
]) {
  try {
    db.exec(`ALTER TABLE setups ADD COLUMN ${col}`);
  } catch {
    /* Spalte vorhanden */
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_signal_id
    ON trade_history(signal_id) WHERE signal_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_snapshot_symbol_asof
    ON signal_snapshots(symbol, as_of);
  CREATE INDEX IF NOT EXISTS idx_setup_events_snapshot
    ON setup_events(snapshot_id, effective_at);
`);

export default db;
