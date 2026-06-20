​Ein hochpräziser Telegram-Bot für automatisierte technische Analysen basierend auf dem Elliott-Wellen-Prinzip. Der Bot kombiniert modernste KI-Modelle mit fraktaler Datenreihenanalyse, um Marktstrukturen objektiv zu bewerten und visualisierte Prognosen zu erstellen.
​🤖 Funktionsweise
​Der Bot fungiert als autonomer Analyst:
​Datenbeschaffung: Abfrage historischer Kursdaten via yahoo-finance2 (V3 API).
​Mathematische Analyse: Ein lokales Gemini-Modell analysiert die Daten unter strikter Einhaltung der mathematischen und strukturellen Regeln der Elliott-Wellen-Theorie (Impulse, Korrekturen, Fibonacci-Verhältnisse).
​Visualisierung: Automatisierte Generierung von Candlestick-Diagrammen mittels Python-Backend (mplfinance, matplotlib) mit eingezeichneter Wellen-Struktur.
​Interaktivität: Der Bot speichert den Analyse-Kontext für gezielte Rückfragen zu spezifischen Wellen oder Fibonacci-Kurszielen.
​🚀 Features
​Striktes Regelwerk: Implementierung der absoluten Gesetze für Motiv- und Korrekturwellen (Alternation, Extension, Fibonacci-Retracements).
​Intelligentes Routing: Automatischer Webhook-Betrieb (via Render) für latenzfreie Kommunikation.
​Fehler-Scanner: Integrierte Diagnose-Pipeline für Python-basierte Grafik-Abstürze direkt im Chat.
​Flexibilität: Analyse für verschiedene Zeitintervalle (1D, 1W, 1M) möglich.
​🛠 Tech-Stack
​Runtime: Node.js (TypeScript)
​KI: Google Gemini 2.5 Flash
​Finanzdaten: Yahoo Finance API (V3)
​Visualisierung: Python, Pandas, Matplotlib, Mplfinance
​Hosting: Render (Cloud-Deployment)
​📋 Befehle
| Befehl | Beschreibung |
| :--- | :--- |
| `/analyse [Symbol]` | Startet die Elliott-Wellen-Analyse für das angegebene Symbol. |
| `[Frage]` | Direkte Rückfragen an den Bot zur letzten Analyse werden kontextbezogen beantwortet. |
⚙️ Elliott-Wellen-Regelwerk (Auszug)
Der Bot arbeitet nach einem formalisierten System-Prompt, das unter anderem folgende Regeln erzwingt:
Impuls-Gesetze: Welle 3 darf niemals die kürzeste sein; kein Overlap zwischen Welle 1 und 4.
Korrektur-Kategorien: Differenzierung zwischen Zigzags, Flats, Triangles und Combinations.
Richtlinien: Anwendung von Fibonacci-Verhältnissen (0.382, 0.618, 1.618) sowie Channeling-Methoden zur Kurszielbestimmung.
Dieser Bot ist ein technisches Hilfsmittel zur Analyse von Marktstrukturen. Er stellt keine Anlageberatung dar.
