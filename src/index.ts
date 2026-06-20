import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2"; // v3 Import

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance(); // v3 Instanzierung

// Konfiguration gegen Timeouts bei langen Berechnungen
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft in der Cloud mit Fehler-Scanner und optimiertem System-Prompt...");

interface ChatSession {
  lastDataPayload: any;
  history: Array<{ role: "user" | "model"; text: string }>;
}

const chatSessions: Record<number, ChatSession> = {};

function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345ABCWXYIV]+):\s*(\d{4}-\d{2}-\d{2})\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    waves.push({
      label: match[1].toUpperCase().trim(),
      date: match[2].trim()
    });
  }
  return waves;
}

bot.command("analyse", async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text.split(" ");
  let symbol = args[1];
  let requestedInterval = args[2] ? args[2].toLowerCase().trim() : "auto";
  
  if (!symbol) {
    return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse TEAM");
  }

  let cleanSymbol = symbol.trim().toUpperCase();
  if (cleanSymbol.includes(":")) {
    cleanSymbol = cleanSymbol.split(":").pop()!;
  }
  if (cleanSymbol === "P911") {
    cleanSymbol = "P911.DE";
  }

  let yahooInterval: "1d" | "1wk" | "1mo" = "1wk";
  let finalIntervalLabel = "1W";

  if (requestedInterval === "1m" || requestedInterval === "mo" || requestedInterval === "m") {
    yahooInterval = "1mo";
    finalIntervalLabel = "1M";
  } else if (requestedInterval === "1d" || requestedInterval === "d") {
    yahooInterval = "1d";
    finalIntervalLabel = "1D";
  }

  await ctx.reply(`⏳ Lade komplette ${finalIntervalLabel}-Historie für ${cleanSymbol} über sicheren API-Tunnel...`);

  let candlesArray: Array<{ date: string; open: string; high: string; low: string; close: string }> = [];

  try {
    const period2 = new Date();
    const period1 = new Date();
    period1.setFullYear(period2.getFullYear() - 3); 

    // v3 Aufruf mit Typ-Zuweisung als Array, um den TS 'never'-Fehler zu eliminieren
    const result = await yahooFinance.historical(cleanSymbol, {
      period1: period1,
      period2: period2,
      interval: yahooInterval
    }) as any[];

    if (!result || result.length === 0) {
      throw new Error("Keine Daten für dieses Symbol gefunden.");
    }

    const rawHistorical = result.map((c: any) => {
      return {
        date: c.date.toISOString().split('T')[0],
        open: Number(c.open).toFixed(2),
        high: Number(c.high).toFixed(2),
        low: Number(c.low).toFixed(2),
        close: Number(c.close).toFixed(2)
      };
    }).filter((c: any) => Number(c.open) > 0 && Number(c.high) > 0 && Number(c.low) > 0 && Number(c.close) > 0);

    candlesArray = rawHistorical;

  } catch (dataError: any) {
    return ctx.reply(`❌ ANALYSE ABGEBROCHEN: Datenfehler: ${dataError.message}`);
  }

  const dataInputJson = JSON.stringify(candlesArray);

  const mainPrompt = `Rolle und Ziel:
Du bist ein rigoroser Mathematiker, Experte für fraktale Datenreihen und ein hochqualifizierter technischer Analyst für das Elliott-Wellen-Prinzip. Deine Aufgabe ist es, die übermittelten historischen Kursdaten im JSON-Format objektiv zu analysieren und hochwahrscheinliche Prognosen zu erstellen, indem du strikt die strukturellen Regeln und analytischen Richtlinien für Motiv- und Korrekturwellen anwendest.

Daten-Array:
${dataInputJson}

I. Fundamentale Struktur
Der Markt bewegt sich fraktal in 5 Wellen in Richtung des übergeordneten Trends (Motive Bewegungen) und in 3 Wellen gegen den Trend (Korrektive Bewegungen). Eine initiale 5-Wellen-Bewegung gegen den Trend ist niemals das Ende einer Korrektur, sondern nur ein Teil davon.

II. Absolute Regeln für Motiv-Wellen (Impulse und Diagonale)
Eine Motiv-Welle unterteilt sich in 5 Wellen und bewegt sich in Richtung des übergeordneten Trends.

Reguläre Impulse:
1. Welle 2 darf niemals mehr als 100 % von Welle 1 korrigieren.
2. Welle 4 darf niemals mehr als 100 % von Welle 3 korrigieren.
3. Welle 3 muss immer über das Ende von Welle 1 hinausgehen.
4. Welle 3 darf niemals die kürzeste der drei Aktionswellen (1, 3 und 5) sein.
5. Welle 4 darf nicht in den Preisbereich von Welle 1 eindringen (kein "Overlap"), mit extrem seltenen Ausnahmen in Hebelmärkten.

Diagonale Dreiecke (Diagonal Triangles): Hier dringt Welle 4 fast immer in den Bereich von Welle 1 ein.
- Ending Diagonal: Tritt primär in Welle 5 (oder C) auf, wenn die Vorbewegung "zu weit, zu schnell" ging. Struktur ist zwingend 3-3-3-3-3.
- Leading Diagonal: Tritt in Welle 1 (oder A) auf und hat die Struktur 5-3-5-3-5.

III. Klassifikation und Regeln für Korrektive Bewegungen
Korrekturen richten sich gegen den Trend und bestehen niemals aus 5 Wellen. Sie unterteilen sich in vier Kategorien:

1. Zigzags (Struktur 5-3-5): Scharfe Korrektur gegen den Trend. Die Spitze von Welle B liegt deutlich unter dem Start von Welle A, und Welle C schließt deutlich über dem Ende von Welle A. Es können doppelte oder dreifache Formationen auftreten (W-X-Y bzw. W-X-Y-X-Z).
2. Flats (Struktur 3-3-5): Seitwärtskorrektur. 
   - Regular Flat: Welle B endet etwa auf Startniveau von Welle A; Welle C endet leicht über dem Ende von Welle A.
   - Expanded Flat: Welle B endet über dem Start von Welle A, Welle C endet deutlich über dem Ende von Welle A.
   - Running Flat: Welle B endet über dem Start von Welle A, aber Welle C erreicht das Ende von Welle A nicht.
3. Triangles (Struktur 3-3-3-3-3): Seitwärtsbewegung (beschriftet a-b-c-d-e). Gehen immer der letzten Aktionswelle voraus (Treten als Welle 4, B oder X auf).
4. Combinations: Seitwärts gerichtete Doppel- oder Dreifach-Threes (W-X-Y / W-X-Y-X-Z), die einfache Korrekturen verbinden. Ein Dreieck tritt nur als allerletzte Welle (Y oder Z) auf.

IV. Wichtige Richtlinien (Guidelines) für die Analyse
- Alternation: In Impulsen: Ist Welle 2 eine scharfe Korrektur, erwarte für Welle 4 eine Seitwärtskorrektur und umgekehrt. In Korrekturen: Beginnt eine große Korrektur mit einem Flat als Welle A, erwarte ein Zickzack für Welle B und umgekehrt.
- Extension: Die meisten Impulse weisen eine Verlängerung in genau einer der Aktionswellen auf. Ist Welle 3 verlängert, sind die Wellen 1 und 5 oft einfach strukturiert und tendieren zu Gleichheit oder einem 0.618-Verhältnis.
- Korrekturtiefen: Bärenmärkte beenden ihre Korrektur oft im Preisbereich der vorhergehenden Welle 4 eines geringeren Grades. Ist Welle 5 eine Extension, wird die folgende Korrektur typischerweise scharf ausfallen und am Tief der Unterwelle 2 dieser Extension enden.
- Truncation: Nach einer außergewöhnlich starken Welle 3 kann Welle 5 das Preisextrem der Welle 3 manchmal nicht übertreffen. Sie muss dennoch aus 5 Unterwellen bestehen.
- Fibonacci Ratio Analyse: Scharfe Korrekturen laufen oft 61.8% oder 50% der Vorwelle zurück. Seitwärtskorrekturen laufen oft nur 38.2% zurück. Welle 4 teilt den gesamten Impulsbereich oft im Goldenen Schnitt (0.382 oder 0.618). In Zigzags ist Welle C oft gleich lang wie Welle A.
- Channeling: Parallele Trendkanäle (verbunden durch die Endpunkte der Wellen 1 und 3, projiziert vom Endpunkt der Welle 2) markieren oft präzise die Ziele für Welle 4 und 5.

FORMATIERUNGS-GESETZE FÜR DIE AUSGABE (ZWINGEND EINHALTEN!):
- Markiere JEDEN wichtigen Wendepunkt (Top/Bottom der Kerze) zwingend exakt in diesem Regex-Format irgendwo im Text: [Welle 3: YYYY-MM-DD].
- Ersetze "3" durch das jeweilige Label und "YYYY-MM-DD" durch das exakte Datum aus dem JSON.
- WICHTIG: Nutze für alle Wellen und Unterwellen AUSSCHLIESSLICH diese Bezeichnungen: 1, 2, 3, 4, 5, A, B, C, W, X, Y, I, II, III, IV, V.
- Verwende absolut keine kleinen römischen Ziffern, keine Klammern um die Bezeichnungen und erfinde keine eigenen Labels!`;

  let responseText = "";
  let attempts = 4; 
  let delay = 2000; 
  
  await ctx.reply(`🧠 Scanne Struktur auf ${finalIntervalLabel}-Basis nach Mustern...`);

  while (attempts > 0) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: mainPrompt,
        config: {
          safetySettings: [
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
          ]
        }
      });
      
      responseText = response.text || "";
      if (responseText) break;
      else throw new Error("Leere Struktur.");
    } catch (apiError: any) {
      attempts--;
      print(`⚠️ API Fehler: ${apiError.message}`);
      if (attempts === 0) {
        return ctx.reply(`❌ Systemfehler: Google blockiert die Anfrage.\n\nGrund: ${apiError.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay += 2000;
    }
  }

  try {
    const wavesData = parseWavesFromText(responseText);
    const analysisText = responseText;

    chatSessions[chatId] = {
      lastDataPayload: { candles: candlesArray, waves: wavesData },
      history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: analysisText }]
    };

    await ctx.reply("🎨 Generiere Candlestick Makro-Chart...");

    const jsonArg = JSON.stringify({ waves: wavesData, candles: candlesArray });
    
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
    
    // Fehler-Scanner fängt Python-Meldungen ab
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    
    pythonProcess.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    pythonProcess.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    pythonProcess.stdin.write(jsonArg);
    pythonProcess.stdin.end();

    pythonProcess.on("close", async (code) => {
      try {
        if (code !== 0 || stdoutChunks.length === 0) {
          const errorLog = Buffer.concat(stderrChunks).toString().trim();
          await ctx.reply(`❌ Fehler beim Zeichnen des Charts.\n\n🛠 **System-Log:**\n\`${errorLog.substring(0, 1000) || "Unbekannter Absturz (Code " + code + ")"}\``);
        } else {
          const outputBuffer = Buffer.concat(stdoutChunks);
          await ctx.replyWithPhoto({ source: outputBuffer }, { caption: `📊 Struktur-Analyse: ${cleanSymbol} (${finalIntervalLabel})` });
        }
        
        const fullText = `📝 Struktur-Bericht:\n\n${analysisText}`;
        const maxLength = 4000;
        for (let i = 0; i < fullText.length; i += maxLength) {
          await ctx.reply(fullText.substring(i, i + maxLength));
        }

      } catch (innerErr: any) {
        console.error("Fehler beim Versand von Chart/Text:", innerErr);
        await ctx.reply(`❌ Fehler bei der Telegram-Ausgabe: ${innerErr.message}`);
      }
    });

  } catch (err: any) {
    await ctx.reply(`❌ Verarbeitungsfehler: ${err.message}`);
  }
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
      config: {
        safetySettings: [
          { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
          { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
        ]
      }
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
        if (!body || body.trim() === "") {
          res.writeHead(200);
          return res.end();
        }

        try {
          const update = JSON.parse(body);
          res.writeHead(200);
          res.end();
          bot.handleUpdate(update);
        } catch (e: any) {
          console.error("⚠️ Ungültiges JSON empfangen:", e.message);
          if (!res.headersSent) {
            res.writeHead(400);
            res.end("Bad Request");
          }
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

  server.listen(PORT, () => {
    print(`🌐 Webhook-Server aktiv auf Port ${PORT}.`);
  });
} else {
  console.log("⚠️ RENDER_EXTERNAL_URL fehlt. Nutze Polling als Fallback...");
  bot.launch();
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
