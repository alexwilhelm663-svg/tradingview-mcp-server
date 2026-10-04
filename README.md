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


## KI-Themen und Handelsoptionen

`/ai rotation`, `/ai adoption` oder `/ai all` analysiert die zugeordneten Assets auf 1wk/5y mit derselben kanonischen Elliott-Entscheidung wie `/deep`. Die Ausgabe zeigt Impulstrend, Gate-Status, bedingten Kauf/Long oder Verkauf/Short-Kandidaten, Trigger, Invalidierung, Modellziel und Datenstand. Ein bestätigtes bestehendes Setup ist keine Freigabe für einen neuen Einstieg zum aktuellen Kurs. Verkauf beschreibt eine technische Short-Richtung, keine persönliche Bestandsentscheidung und keine Orderausführung.

- `AI_CAPITAL_ROTATION`: NVDA, AMD, MSFT, AMZN und BTC-USD. Hypothese: Kapital kann zu KI statt BTC fließen; Kursperformance beweist diesen Fluss nicht.
- `AI_BITCOIN_ADOPTION`: BTC-USD direkt, MSTR als Treasury-Proxy, COIN als gemischter Zahlungsinfrastruktur-Proxy. CRCL ist ein Stablecoin-Konkurrenz-/Kontrollasset, kein BTC-Adoptionsproxy.

Die Themenrichtung bleibt `UNKNOWN`, bis verifizierte aktuelle Kapitalflüsse bzw. wirtschaftliche Agentennutzung und zusätzliche BTC-Bestände vorliegen. Es gibt in dieser Erweiterung keinen automatischen Flow-/Adoptionsdatenfeed. Frühere behauptete Korrelationszahlen werden nicht als Messdaten übernommen. Langfristige Adoption löst niemals ein kurzfristiges Kaufsignal aus. Themenzuordnung bezeichnet Exposure, keine garantierte Begünstigung.

Elliott-Regeln, Korrekturanalyse, 1-2-Scanner, Point-in-Time-Prüfung und eingefrorene Level bleiben unverändert. `/deep` ergänzt für Themenassets Kontext und Handelsoption als Text. Brokerverfügbarkeit, Short-Instrument/Leihe und aktuelle Ausführungspreise werden nicht geprüft.

Prüfung: `npm run build`, `npm run verify:ai`, `npm run verify:integrity`, `npm run verify:deep`, `npm run verify:scan12`.
