import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Sicherstellen, dass das Data-Verzeichnis existiert
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
    console.log("📂 Erstelle Datenverzeichnis...");
    fs.mkdirSync(dataDir, { recursive: true });
}

// Datenbank-Pfad
const dbPath = path.join(dataDir, 'trading_bot.db');
const db = new Database(dbPath);

// Initialisierung erzwingen
console.log(`💾 Initialisiere Datenbank unter: ${dbPath}`);
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


// Test-Zugriff beim Start
try {
  db.prepare("INSERT INTO trade_history (symbol, signal_type, entry_price) VALUES (?, ?, ?)")
    .run("TEST", "INIT", 0.0);
  console.log("✅ Datenbank-Schreibtest erfolgreich.");
} catch (e) {
  console.error("❌ Datenbank-Schreibfehler:", e);
}
