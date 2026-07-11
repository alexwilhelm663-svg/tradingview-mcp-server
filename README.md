# EW Quant Hunter (Bot V110.1: Hybrid Dual-Hunter)

Ein Node.js-basierter Telegram-Bot für automatisierte quantitative Finanzanalysen, Elliott-Wellen-Tracking und automatische Chart-Generierung. Der Bot läuft als hybrider Dienst, der sowohl auf manuelle Befehle reagiert als auch im Hintergrund automatisierte Markt-Scans (Radar) durchführt.

## 🚀 Features

* **On-Demand Analysen:** Direkte Abfrage von Finanzinstrumenten (z.B. Krypto, Aktien) via Telegram-Befehl mit sofortiger Chart-Ausgabe.
* **Automatisierter Radar-Scan:** Stündlicher Cronjob, der eine vordefinierte Watchlist auf Elliott-Wellen-Setups (Breakouts & Hot Setups) prüft.
* **Smart Alerting:** Integriertes SQLite-Alert-Management mit einem 7-Tage-Cooldown pro Asset, um Spam im Telegram-Chat zu verhindern.
* **Render-Ready:** Vollständig optimiert für das Hosting auf Render.com inklusive Dummy-HTTP-Server (gegen Port-Timeouts) und Graceful Shutdown (`SIGTERM`/`SIGINT`), um Bot-Konflikte bei Deployments zu vermeiden.

## 🛠️ Tech-Stack

* **Backend:** Node.js, TypeScript
* **Bot-Framework:** Telegraf (Telegram Bot API)
* **Datenbank:** SQLite (`better-sqlite3` oder ähnlich) für Konfiguration, Watchlist und Alerts
* **Scheduling:** `node-cron`
* **Infrastruktur:** Express / HTTP-Modul für Health-Checks

## 🤖 Telegram Befehle

Sobald der Bot läuft, stehen in Telegram folgende Befehle zur Verfügung:

* `/start` – Initialisiert den Bot und speichert die aktuelle Chat-ID in der Datenbank. **Wichtig:** Muss als Erstes ausgeführt werden, damit der automatische Radar-Scan weiß, wohin er die Alarme senden soll.
* `/watchlist` – Gibt eine Liste aller Symbole aus, die sich aktuell in der SQLite-Datenbank befinden und vom Radar überwacht werden.
* `/analyse [SYMBOL]` – Startet eine sofortige, manuelle Analyse für ein spezifisches Asset (z. B. `/analyse btc-usd`). Der Bot berechnet das Setup und antwortet mit dem generierten Chart-Screenshot.

## ⚙️ Setup & Installation

### 1. Umgebungsvariablen (.env)
Erstelle eine `.env`-Datei im Hauptverzeichnis mit folgenden Werten:
```env
TELEGRAM_BOT_TOKEN=dein_telegram_bot_token
PORT=10000
