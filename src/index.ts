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

console.log("🤖 Bot läuft in der Cloud mit All-Time Max Genesis & Tabellen-Semantik-Schutz (v19)...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromText(text: string): Array<{ label: string; date: string; price: number }> {
  const waves: Array<{ label: string; date: string; price: number }> = [];
  const lines = text.split('\n');

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
    
    if (parts.length >= 2 && /\d/.test(parts[1])) {
        let label = parts[0].replace(/[\*\`]/g, '').trim(); 
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

  await ctx.reply(`⏳ Scanne Yahoo-Server nach absoluter All-Time-Datenreihe ab IPO für ${cleanSymbol}...`);

  let candlesArray: any[] = [];

  try {
    const period2 = new Date();
    const period1 = new Date("1970-01-01");

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

  const minifiedMarketStream = candlesArray.map(c => `${c.date},${c.high},${c.low}`).join("|");

  const streamStartDate = candlesArray[0].date;
  const streamEndDate = candlesArray[candlesArray.length - 1].date;

  const mainPrompt = `Rolle und Ziel:
Du bist ein erstklassiger technischer Analyst und Senior-Experte für das Elliott-Wellen-Prinzip (Senior-EW-Analyst). Analysiere den folgenden komprimierten Marktdaten-Stream. Da Asset-Preise exponentiell wachsen, wird deine Zählung auf einer logarithmischen Y-Achse dargestellt.

Komprimierter Kurs-Stream (Format: Datum,High,Low | Datum,High,Low):
${minifiedMarketStream}

---
SYSTEM-REGELWERK (ELLIOTT-WELLEN-PRINZIP):

Gemäß dem Elliott-Wellen-Prinzip werden alle Marktbewegungen in zwei grundlegende Kategorien unterteilt: **Motive Wellen** (die den übergeordneten Trend vorantreiben) und **Korrektive Wellen** (die sich gegen den übergeordneten Trend richten). Im Folgenden sind die detaillierten Regeln und Richtlinien für beide Wellenarten zusammengefasst.

### 1. Motive Wellen
Motive Wellen bestehen immer aus fünf Unterwellen und bewegen sich in die gleiche Richtung wie der Trend des nächstgrößeren Grades. Sie haben die Aufgabe, den Markt kraftvoll voranzutreiben.

**Harte Regeln für Motive Wellen (Impulse):**
* **Welle 2** darf Welle 1 niemals zu mehr als 100 % korrigieren (sie darf nicht über den Startpunkt von Welle 1 hinausgehen).
* **Welle 4** darf Welle 3 niemals zu 100 % korrigieren und darf nicht in das Preisgebiet von Welle 1 eindringen (Überschneidungsverbot). Ausnahmen bilden hierbei nur diagonale Dreiecke.
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

---

### 3. ZWANGS-PARAMETER FÜR DEN ALL-TIME MAX TOTAL-SCAN

* **PFLICHTSTART BEIM ALLERERSTEN YAHOO-DATENPUNKT (IPO):** Die dir übergebenen Kursdaten starten am **${streamStartDate}**. Du bist mathematisch VERPFLICHTET, den Startpunkt deiner Zählung (Welle 0) exakt auf dieses absolute historische Startdatum zu legen! Der allererste Eintrag deiner Markdown-Tabelle MUSS zwingend lauten: \`| 0 | ${streamStartDate} | [Preis] |\`. Es ist dir verboten, die Zählung an einem späteren Zeitpunkt zu beginnen.
* **PFLICHT ZUR LÜCKENLOSEN TOTAL-ZÄHLUNG BIS ZUM ENDDATUM:** Die Zeitreihe endet am **${streamEndDate}**. Du bist verpflichtet, sämtliche Wellenzyklen von der Geburtsstunde ${streamStartDate} bis zum Enddatum ${streamEndDate} lückenlos durchzuzählen! Wenn du Welle C erreichst und feststellst, dass im Stream noch Daten existieren, eröffnest du nahtlos den nächsten Zyklus. Der letzte Eintrag deiner Tabelle MUSS das Enddatum **${streamEndDate}** erreichen.
* **DAS PRINZIP DER GENERISCHEN DEHNUNG (EXTENSION):** Gemäß der Richtlinie für Dehnungen neigt in einem Motiv-Impuls fast immer exakt eine Welle zu einer massiven Verlängerung. Eine gedehnte Welle unterteilt sich auf dem untergeordneten Grad selbst wieder in 5 Motiv-Wellen. Wenn der Vektor einer Antriebswelle auf der Log-Skala extrem lang ist, bist du mathematisch aufgefordert, diese Welle generisch zu entpacken (z.B. 1, 2, (1), (2), (3), (4), (5), 4, 5 in der Tabelle).

---

### 4. EISERNE TABELLEN-SEMANTIK & FEHLER-PRÄVENTION
Um mathematische Kollisionen im nachfolgenden Python-Renderer zu verhindern, hältst du dich beim Ausfüllen der Markdown-Tabelle an folgende Gesetze:

1. **Das Endpunkt-Gesetz für Eltern-Zeilen:** Zeilen eines übergeordneten Grades (z.B. [I], [II], [III], (3), W, Y) deklarieren in der Spalte "Preis" und "Datum" IMMER das exakte ZIEL bzw. das ENDE dieser Bewegung, NIEMALS den Startpunkt! Der Preis von [I] muss exakt identisch mit dem Endpreis seiner Unterwelle (5) sein.
2. **Verbot von Amputationen:** Du darfst einen Primärgrad erst dann abschließen, wenn alle seine Untergrade in der Tabelle stehen! Nach Welle 3.5 folgt zwingend Welle (4) und (5), bevor der Hauptimpuls beendet ist.
3. **Absolutes Klon-Verbot:** Es ist dir verboten, exakt denselben Fließkommapreis für zwei unterschiedliche historische Extreme zu recyceln.
4. **Echte Regular Flats:** Ein Regular Flat verlangt, dass Welle C auf das nahezu exakt gleiche Preisniveau wie Welle A fällt.

---
FORMATIERUNGS-GESETZE FÜR DIE AUSGABE:
Erstelle am Ende deiner Analyse ZWINGEND eine Markdown-Tabelle exakt nach diesem Muster. Beginne zwingend bei ${streamStartDate} und führe die Wellen durch die Jahre, bis das Enddatum ${streamEndDate} erreicht ist!

| Welle | Datum | Preis |
| --- | --- | --- |
| 0 | ${streamStartDate} | 15.50 |
| [I] | YYYY-MM-DD | 188.75 |

Keine Prosa in der Tabelle!`;

  let responseText = "";
  let attempts = 5; 
  let backoffDelay = 2000; 

  await ctx.reply(`🧠 Analysiere maximale Yahoo-Historie ab IPO (${streamStartDate} bis ${streamEndDate})...`);

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
          return ctx.reply(`❌ **KI-Analyse abgebrochen:** Google Gemini API Timeout nach 5 Versuchen.\nGrund: ${e.message}`);
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
                statusBadge = `\n\n🟢 **STATUS:** Laufende Korrektur bestätigt beendet! (Schlusskurs ${cg.current_close.toFixed(2)} USD liegt über der Schranke von ${cg.b_gate_price.toFixed(2)} USD).`;
            } else {
                statusBadge = `\n\n⚠️ **STATUS:** Letzte Abwärtswelle weiterhin AKTIV! (Schlusskurs ${cg.current_close.toFixed(2)} USD notiert unter dem Bestätigungs-Gate von ${cg.b_gate_price.toFixed(2)} USD).\n🎯 **BERECHNETE FIBO-ZIELZONE:** ${cg.fib_lower.toFixed(2)} USD bis ${cg.fib_upper.toFixed(2)} USD (Sweetspot: ${cg.fib_sweetspot.toFixed(2)} USD).`;
            }
        }
    } catch(e) {}

    if (isDebug && errLog) {
        await ctx.reply(`🩻 **PYTHON TELEMETRIE:**\n\`\`\`json\n${errLog.substring(0, 3800)}\n\`\`\``);
    }

    if (code !== 0 || stdoutChunks.length === 0) {
        await ctx.reply(`❌ **Zeichnen fehlgeschlagen!** Log:\n\`\`\`text\n${errLog}\n\`\`\``);
    } else {
        await ctx.replyWithPhoto({ source: Buffer.concat(stdoutChunks) }, { caption: `📊 EW All-Time Genesis Master View: ${cleanSymbol} (${finalIntervalLabel})` });
    }
    
    const fullReport = responseText + statusBadge;
    const chunkSize = 4000;
    
    for (let i = 0; i < fullReport.length; i += chunkSize) {
        await ctx.reply(fullReport.substring(i, i + chunkSize));
    }
  });
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat.id;
  const userQuestion = ctx.message.text;
  const session = chatSessions[chatId];

  if (!session || !session.lastDataPayload) return ctx.reply("❌ Starte zuerst eine Analyse mit `/analyse`.");

  await ctx.reply("🤔 Analysiere Rückfrage...");

  try {
    session.history.push({ role: "user", text: userQuestion });
    const contents: any[] = [];
    session.history.forEach(msg => contents.push(`${msg.role === "user" ? "User" : "Model"}: ${msg.text}`));
    contents.push(`Beziehe dich auf Rohdaten: ${JSON.stringify(session.lastDataPayload.candles)}. Antworte kurz.`);

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
  
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        try { if (body.trim()) bot.handleUpdate(JSON.parse(body)); } catch (e) {}
      });
    } else res.end("Bot Server is healthy");
  }).listen(PORT);
} else bot.launch();
