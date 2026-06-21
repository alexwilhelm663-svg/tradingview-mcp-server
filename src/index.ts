import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft in der Cloud mit vollständigem Frost & Prechter EW-Kanon (v7)...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

// Kugelsicherer Parser: Prüft Spalte 1 auf Datums-Ziffern. Völlig immun gegen Text-Präfixe.
function parseWavesFromText(text: string): Array<{ label: string; date: string; price: number }> {
  const waves: Array<{ label: string; date: string; price: number }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
    
    // Gültige Zeile: Mindestens 2 Spalten UND die Datums-Spalte (Index 1) enthält Ziffern
    if (parts.length >= 2 && /\d/.test(parts[1])) {
        let label = parts[0].replace(/[\*\`\[\]]/g, '').trim();
        label = label.replace(/^(?:Welle|Wave|Top|Bottom|Punkt|Pivot)\s+/i, '').trim();
        
        const rawDate = parts[1].replace(/[\*\`\[\]]/g, '').trim();
        
        let price = 0;
        if (parts.length >= 3) {
            const priceMatch = parts[2].match(/[-0-9.,]+/);
            if (priceMatch) price = parseFloat(priceMatch[0].replace(',', '.'));
        }
        
        if (label && rawDate) {
            waves.push({ label, date: rawDate, price });
        }
    }
  }

  return waves;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const rawText = ctx.message.text;
  const args = rawText.split(" ");
  
  const symbol = args[1];
  const isDebug = rawText.toLowerCase().includes("debug");
  
  let requestedInterval = "auto";
  if (args[2] && args[2].toLowerCase() !== "debug") {
      requestedInterval = args[2].toLowerCase().trim();
  }

  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse MSTR");

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) cleanSymbol = cleanSymbol.split(":").pop()!;
  if (cleanSymbol === "P911") cleanSymbol = "P911.DE";

  let yahooInterval: "1d" | "1wk" | "1mo" = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  } else if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  }

  await ctx.reply(`⏳ Lade 10-Jahres-Historie (${finalIntervalLabel}) für ${cleanSymbol}...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setFullYear(period2.getFullYear() - 10); 

    const result = await yahooFinance.historical(cleanSymbol, { period1, period2, interval: yahooInterval }) as any[];
    if (!result || result.length === 0) throw new Error("Yahoo lieferte ein leeres Array.");

    candlesArray = result.map(c => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(2),
      high: Number(c.high).toFixed(2),
      low: Number(c.low).toFixed(2),
      close: Number(c.close).toFixed(2)
    })).filter(c => Number(c.open) > 0);

  } catch (dataError: any) {
    return ctx.reply(`❌ Yahoo Datenfehler: ${dataError.message}`);
  }

  // Daten-Kompression: Nur 12 Kilobyte Payload für die KI
  const minifiedMarketStream = candlesArray.map(c => `${c.date},${c.high},${c.low}`).join("|");

  // =========================================================================
  // DAS VOLLSTÄNDIGE MASTER-REGELWERK IST ZURÜCK IM SYSTEM-PROMPT
  // =========================================================================
  const mainPrompt = `Rolle und Ziel:
Du bist ein erstklassiger technischer Analyst und Senior-Experte für das Elliott-Wellen-Prinzip (Senior-EW-Analyst). Analysiere den folgenden komprimierten Marktdaten-Stream. Da Asset-Preise exponentiell wachsen, wird deine Zählung auf einer logarithmischen Y-Achse dargestellt.

Komprimierter Kurs-Stream (Format: Datum,High,Low | Datum,High,Low):
${minifiedMarketStream}

---
SYSTEM-REGELWERK (ELLIOTT-WELLEN-PRINZIP):

Gemäß dem Elliott-Wellen-Prinzip werden alle Marktbewegungen in zwei grundlegende Kategorien unterteilt: **Motive Wellen** (die den übergeordneten Trend vorantreiben) und **Korrektive Wellen** (die sich gegen den übergeordneten Trend richten). Ein vollständiger Superzyklus besteht aus einem 5-Wellen-Impuls (1-2-3-4-5) gefolgt von einer dreiteiligen Korrektur (A-B-C).

### 1. Motive Wellen
Motive Wellen bestehen immer aus fünf Unterwellen und bewegen sich in die gleiche Richtung wie der Trend des nächstgrößeren Grades. Sie haben die Aufgabe, den Markt kraftvoll voranzutreiben.

**Harte Regeln für Motive Wellen (Impulse):**
* **Welle 2** darf Welle 1 niemals zu mehr als 100 % korrigieren (orthodoxes Tief Welle 2 >= Start Welle 0).
* **Welle 4** darf Welle 3 niemals zu 100 % korrigieren und darf nicht in das Preisgebiet von Welle 1 eindringen (Überschneidungsverbot / Kein Overlap!). Das Tief von Welle 4 muss zwingend strikt ÜBER dem Hoch von Welle 1 liegen. Ausnahmen bilden hierbei nur diagonale Dreiecke.
* **Welle 3** wandert immer über das Ende von Welle 1 hinaus.
* **Welle 3 ist nie die kürzeste** unter den drei Antriebswellen (1, 3 und 5).
* Die Antriebswellen 1, 3 und 5 sind selbst motive Wellen, und Unterwelle 3 ist immer zwingend ein Impuls.

**Richtlinien für Motive Wellen:**
* **Extensionen (Dehnungen):** Die allermeisten Impulse weisen in exakt einer der drei Antriebswellen (1, 3 oder 5) eine deutlich verlängerte Dehnung auf. Eine solche Sequenz sieht dann oft wie neun Wellen ähnlicher Größe aus statt wie fünf. Im Aktienmarkt ist meistens die Welle 3 die gestreckte Welle.
* **Trunkierung (Verkürzung):** Gelegentlich schafft es Welle 5 nicht, über das Ende der Welle 3 hinauszugehen. Dies folgt oft auf eine extrem starke Welle 3 und signalisiert eine bevorstehende dramatische Umkehr.
* **Alternation (Abwechslung):** Innerhalb eines Impulses unterscheiden sich Welle 2 und Welle 4 fast immer in ihrer Form. Wenn Welle 2 eine scharfe Korrektur (Zickzack) ist, wird Welle 4 normalerweise eine Seitwärtskorrektur (Flat oder Dreieck) sein und umgekehrt.
* **Gleichheit:** Zwei der Antriebswellen (meistens Welle 1 und 5, wenn Welle 3 eine Extension ist) streben nach Gleichheit in Dauer und Ausmaß. Ist keine perfekte Gleichheit gegeben, liegt oft ein Fibonacci-Verhältnis von 0,618 vor.
* **Kanalisierung:** Parallele Trendkanäle markieren typischerweise die oberen und unteren Grenzen von Impulsen.
* **Throw-over:** Nähert sich die fünfte Welle bei sinkendem Volumen der oberen Trendkanallinie, wird sie diese oft nur genau treffen oder verfehlen. Bei hohem Volumen ist jedoch ein "Throw-over" (ein kurzes Durchbrechen der Kanallinie nach oben) wahrscheinlich, bevor der Trend umkehrt.

**Diagonale Dreiecke (Ausnahme von Impulsen):**
Diagonale Dreiecke sind motive Wellen, die jedoch nicht als echte Impulse gelten, da sie korrektive Eigenschaften aufweisen. Bei ihnen dringt Welle 4 fast immer in das Preisgebiet von Welle 1 ein.
* **Ending Diagonals:** Treten meist als Welle 5 auf, wenn eine Bewegung "zu weit und zu schnell" gegangen ist. Sie haben eine Keilform mit konvergierenden (sich annähernden) Linien und bestehen ungewöhnlicherweise aus einer 3-3-3-3-3-Struktur.
* **Leading Diagonals:** Finden sich nur in der Position der Welle 1 oder A. Sie haben ebenfalls eine Keilform und eine Überschneidung der Welle 4 und 1, behalten aber eine 5-3-5-3-5-Struktur bei. Sie weisen eher auf eine Fortsetzung als auf eine Beendigung hin.

---

### 2. Korrektive Wellen
Korrektive Wellen bewegen sich immer gegen den übergeordneten Trend. Sie stellen in der Regel einen "Kampf" gegen den dominierenden Trend dar und sind daher schwerer zu identifizieren als motive Wellen.

**Wichtigste Regel:** Eine Korrektur besteht niemals aus fünf Wellen. Eine erste 5-Wellen-Bewegung gegen den Trend ist daher nie das Ende einer Korrektur, sondern nur ein Teil davon.

Korrekturen lassen sich in vier Hauptkategorien unterteilen:

**A. Zickzacks / Zigzags (5-3-5):**
* Dies sind scharfe Korrekturen, die steil gegen den Trend verlaufen.
* Sie werden als A-B-C markiert, wobei die Unterwellenstruktur 5-3-5 aufweist.
* Die Spitze der Welle B liegt dabei merklich tiefer als der Start der Welle A.
* Manchmal können sie doppelt oder dreifach hintereinander auftreten (getrennt durch eine X-Welle), um ein angemessenes Preisziel zu erreichen (Doppel-Zickzack, Triple-Zickzack).

**B. Flache Korrekturen / Flats (3-3-5):**
* Dies sind Seitwärtskorrekturen, bei denen der Preis per Saldo retraced wird, die aber insgesamt flach verlaufen.
* Ihre Unterwellenstruktur ist 3-3-5. Sie korrigieren oft schwächer und treten bei starken übergeordneten Trends auf.
* **Reguläres Flat:** Welle B endet nahe dem Beginn von Welle A, Welle C reicht leicht über das Ende von Welle A hinaus.
* **Expanded Flat (Erweitert):** Die mit Abstand häufigste Form. Hier zieht Welle B in neues Preisterrain über den Start von Welle A hinaus, und Welle C endet substanziell unter dem Ende von Welle A.
* **Running Flat (Laufend):** Welle B schießt wie beim Expanded Flat über das Ziel hinaus, aber Welle C ist zu schwach und erreicht nicht das Ende von Welle A. Diese Form ist sehr selten.

**C. Dreiecke / Triangles (3-3-3-3-3):**
* Spiegeln ein Gleichgewicht der Kräfte wider, was zu einer Seitwärtsbewegung mit meist sinkendem Volumen und nachlassender Volatilität führt.
* Bestehen aus fünf überlappenden Wellen (a-b-c-d-e) und werden durch Verbindungslinien von a-c und b-d begrenzt.
* **Position:** Dreiecke treten immer vor der letzten aktiven Welle im übergeordneten Muster auf, d.h. als Welle 4, Welle B oder als letzte Welle X in einer Kombination. Auf sie folgt fast immer ein starker, aber kurzer Schub ("Thrust") in Richtung des Haupttrends.

**D. Kombinierte Strukturen (Double/Triple Threes):**
* Hier reihen sich einfache Korrekturen (wie Flat, Zickzack, Dreieck) waagerecht aneinander, verbunden durch eine reaktive Welle X.
* Sie entstehen meistens, um eine Korrektur zeitlich in die Länge zu ziehen, wenn die Preisziele bereits erfüllt sind.
* In solchen Kombinationen taucht niemals mehr als ein Zickzack oder ein einziges Dreieck (stets am Ende) auf.

**Wichtige Richtlinien für Korrekturen:**
* **Tiefe von Bärenmärkten:** Korrekturen enden typischerweise im Preisgebiet der vorausgegangenen Welle 4 eines niedrigeren Grades.
* **Verhalten nach einer gedehnten Welle 5:** Wenn die fünfte Welle eines Impulses eine Extension war, wird die darauffolgende Korrektur in der Regel sehr scharf ausfallen und Unterstützung am Tief der Welle 2 dieser Extension finden.
* **Abwechslung in der Komplexität:** Oft wechselt die Komplexität innerhalb der Korrekturwellen ab. Ist beispielsweise Welle A ein einfaches Zickzack, dehnt sich Welle B oft in eine viel komplexere Form aus und Welle C unter Umständen in eine noch weitreichendere.

**DAS B-GATE GESETZ FÜR WELLE C:**
Eine Korrektur ist mathematisch erst dann sicher beendet, wenn der Markt das Top der Welle B impulsiv überschritten hat! Liegt der aktuelle Kurs noch unterhalb des Hochs von Welle B, befindet sich der Markt noch IN der Korrektur. Welle C ist in diesem Fall eine unbestätigte, laufende Projektion.

---
FORMATIERUNGS-GESETZE FÜR DIE AUSGABE:
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem vollständigen Muster. 
Du MUSST alle 8 Wellen des Zyklus angeben: Boden (0) -> 5 Impulswellen (1,2,3,4,5) -> 3 Korrekturwellen (A,B,C).
Die zeitliche Abfolge MUSS streng kausal vorwärtsgerichtet sein: Datum(0) < Datum(1) < Datum(2) < Datum(3) < Datum(4) < Datum(5) < Datum(A) < Datum(B) < Datum(C).

| Welle | Datum | Preis |
| --- | --- | --- |
| 0 | YYYY-MM-DD | 15.50 |
| 1 | YYYY-MM-DD | 180.00 |
| 2 | YYYY-MM-DD | 100.00 |
| 3 | YYYY-MM-DD | 1500.00 |
| 4 | YYYY-MM-DD | 1100.00 |
| 5 | YYYY-MM-DD | 1900.00 |
| A | YYYY-MM-DD | 1300.00 |
| B | YYYY-MM-DD | 1650.00 |
| C | YYYY-MM-DD | 1050.00 |

Nutze als Bezeichnungen ausschließlich: 0, 1, 2, 3, 4, 5, A, B, C. Keine Prosa in der Tabelle!`;

  let responseText = "";
  let attempts = 5; 
  let backoffDelay = 2000; 

  await ctx.reply("🧠 Analysiere 8-Wellen Superzyklus mit Frost & Prechter Master-Kanon...");

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
        config: { safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] }
      });
      responseText = response.text || "";
      if (responseText) break;
    } catch (e: any) {
      attempts--;
      if (attempts === 0) {
          return ctx.reply(`❌ **KI-Analyse abgebrochen:** Google Gemini API Timeout.\nGrund: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, backoffDelay));
      backoffDelay *= 2;
    }
  }

  const wavesData = parseWavesFromText(responseText);

  if (wavesData.length === 0) {
      return ctx.reply(`🚨 **PARSER-FEHLER:** Die KI hat keine auslesbare Tabelle geliefert.\n\nRoher Output:\n\`\`\`text\n${responseText.substring(0, 3800)}\n\`\`\``);
  }

  chatSessions[chatId] = {
    lastDataPayload: { candles: candlesArray, waves: wavesData },
    history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: responseText }]
  };

  const jsonArg = JSON.stringify({ symbol: cleanSymbol, waves: wavesData, candles: candlesArray });
  
  const pythonCommand = process.platform === "win32" ? "python" : "python3";
  const pythonProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
  
  const stdoutChunks: Buffer[] = [];
  let errLog = "";

  pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  pythonProcess.stderr.on("data", (chunk: Buffer) => errLog += chunk.toString());

  pythonProcess.stdin.write(jsonArg);
  pythonProcess.stdin.end();

  pythonProcess.on("close", async (code) => {
    let statusBadge = "";
    try {
        const pyReport = JSON.parse(errLog);
        if (pyReport.correction_gate) {
            const cg = pyReport.correction_gate;
            if (cg.is_confirmed) {
                statusBadge = `\n\n🟢 **STATUS:** Zyklus-Korrektur bestätigt beendet! (Schlusskurs ${cg.current_close.toFixed(2)} USD hat das B-Gate bei ${cg.b_gate_price.toFixed(2)} USD erfolgreich nach oben durchbrochen).`;
            } else {
                statusBadge = `\n\n⚠️ **STATUS:** Korrektur weiterhin AKTIV! (Schlusskurs ${cg.current_close.toFixed(2)} USD notiert unter dem B-Gate von ${cg.b_gate_price.toFixed(2)} USD. Welle C ist eine unbestätigte Projektion).`;
            }
        }
    } catch(e) {}

    if (isDebug && errLog) {
        await ctx.reply(`🩻 **PYTHON TELEMETRIE:**\n\`\`\`json\n${errLog.substring(0, 3800)}\n\`\`\``);
    }

    if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ **Zeichnen fehlgeschlagen!** Log:\n\`\`\`text\n${errLog}\n\`\`\``);
    } else {
        await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 EW Supercycle (Log-Scale): ${cleanSymbol} (${finalIntervalLabel})` });
    }
    
    await ctx.reply((responseText + statusBadge).substring(0, 4000));
  });
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastDataPayload) {
    return ctx.reply("❌ Starte zuerst eine Analyse mit `/analyse`.");
  }

  await ctx.reply("🤔 Analysiere Rückfrage...");

  try {
    session.history.push({ role: "user", text: userQuestion });
    const contents: any[] = [];
    session.history.forEach(msg => {
      contents.push(`${msg.role === "user" ? "User" : "Model"}: ${msg.text}`);
    });
    contents.push(`Beziehe dich auf folgende Rohdaten: ${JSON.stringify(session.lastDataPayload.candles)}. Beantworte die Frage kurz.`);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: { safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] }
    });

    const answerText = response.text || "Keine Antwort möglich.";
    session.history.push({ role: "model", text: answerText });
    await ctx.reply(`💬 Antwort:\n\n${answerText}`);
  } catch (error: any) {
    await ctx.reply(`❌ Fehler: ${error.message}`);
  }
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  
  const server = http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        // Sofortiges Acknowledge an Telegram (0 Retries)
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));

        try {
          if (body.trim()) {
            const update = JSON.parse(body);
            bot.handleUpdate(update);
          }
        } catch (e: any) {
          console.error("⚠️ Webhook JSON Fehler:", e.message);
        }
      });
    } else if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Bot Server is healthy");
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });

  server.listen(PORT, () => console.log(`🌐 Webhook aktiv auf Port ${PORT}.`));
} else {
  bot.launch();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
    
