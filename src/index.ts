import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import YahooFinance from "yahoo-finance2";
import { getElliottWaveSystemPrompt } from "./prompt";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const yahooFinance = new YahooFinance();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Bot läuft in der Cloud mit 4-Dezimalen-Quant-Präzision & GenAI 2.0 Pool (v28)...");

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

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errLog: string, validationData: { valid: boolean, message: string } | null }> {
  return new Promise((resolve) => {
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    const pyProcess = spawn(pythonCommand, ["python_service/drawer.py"]);
    
    const stdoutBufs: Buffer[] = [];
    let stderrStr = "";

    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();

    pyProcess.on("close", () => {
      let val = null;
      try {
        const parsed = JSON.parse(stderrStr);
        if (parsed.validation) val = parsed.validation;
      } catch(e) {}

      const photoBuf = stdoutBufs.length > 0 ? Buffer.concat(stdoutBufs) : null;
      resolve({ pngBuffer: photoBuf, errLog: stderrStr, validationData: val });
    });
  });
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

  if (!symbol) return ctx.reply("❌ Bitte gib ein Symbol an! Beispiel: /analyse NVDA");

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

    // FIX: 4 Nachkommastellen für historische Penny-Stock-Fraktale (NVDA 1999)
    candlesArray = result.map(c => ({
      date: c.date.toISOString().split('T')[0],
      open: Number(c.open).toFixed(4),
      high: Number(c.high).toFixed(4),
      low: Number(c.low).toFixed(4),
      close: Number(c.close).toFixed(4)
    })).filter(c => Number(c.open) > 0);

  } catch (dataError: any) {
    return ctx.reply(`❌ Yahoo Datenfehler: ${dataError.message}`);
  }

  const minifiedMarketStream = candlesArray.map(c => `${c.date},${c.high},${c.low}`).join("|");
  const streamStartDate = candlesArray[0].date;
  const streamEndDate = candlesArray[candlesArray.length - 1].date;

  const basePrompt = getElliottWaveSystemPrompt(streamStartDate, streamEndDate, minifiedMarketStream);

  let currentPrompt = basePrompt;
  let finalResponseText = "";
  let finalErrLogLog = "";
  let finalPhotoBuffer: Buffer | null = null;
  
  let iteration = 0;
  const maxIterations = 3;
  let criticRejectionReason = "";

  // FIX: Saubere GenAI v1beta Model-Pool Kaskade
  const modelPool = [
      "gemini-2.5-flash", 
      "gemini-2.0-flash", 
      "gemini-2.5-pro"
  ];

  await ctx.reply(`⏳ Starte **Automated Actor-Critic Self-Healing Pipeline** für ${cleanSymbol} (Max 3 Topologie-Iterationen)...`);

  while (iteration < maxIterations) {
    iteration++;
    const activeModel = modelPool[iteration-1] || "gemini-2.5-flash";

    if (criticRejectionReason) {
      await ctx.reply(`⚠️ **Python-Kritiker Veto (Runde ${iteration-1}/${maxIterations}):** *"${criticRejectionReason}"*\nSperre KI mit Veto-Befund erneut ins Verhörzimmer (Modell: ${activeModel})...`);
      
      currentPrompt = `KORREKTUR-ZYKLUS (Stufe ${iteration}/${maxIterations}):\n\nDeine vorherige Wellen-Tabelle wurde vom mathematischen Python-Kritiker mit folgendem harten Veto abgelehnt:\n\n[ "${criticRejectionReason}" ]\n\nDu bist VERPFLICHTET, exakt diesen topologischen Fehler in den Werten der Tabelle zu korrigieren! Verändere ausschließlich die fehlerhaften Zeilen, behalte das IPO-Startdatum ${streamStartDate} bei und gib unten erneut die korrigierte, vollständige Markdown-Tabelle aus.\n\nHier sind nochmal die Marktdaten zur Orientierung:\n${minifiedMarketStream}`;
    }

    let llmRawAnswer = "";
    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: currentPrompt,
        config: { 
            maxOutputTokens: 8192, 
            safetySettings: [{ category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE }] 
        }
      });
      llmRawAnswer = response.text || "";
    } catch(e: any) {
      await ctx.reply(`⚠️ API-Schluckauf in Runde ${iteration}: ${e.message}. Versuche nächsten Step...`);
      await new Promise(r => setTimeout(r, 3000));
      continue;
    }

    const candidateWaves = parseWavesFromText(llmRawAnswer);
    if (candidateWaves.length === 0) {
      criticRejectionReason = "LLM hat keine auslesbare Markdown-Tabelle geliefert.";
      continue;
    }

    const pyCritic = await runPythonCritic(cleanSymbol, candidateWaves, candlesArray);

    if (pyCritic.validationData && pyCritic.validationData.valid) {
      finalPhotoBuffer = pyCritic.pngBuffer;
      finalErrLogLog = pyCritic.errLog;
      finalResponseText = llmRawAnswer;
      break;
    } else {
      criticRejectionReason = pyCritic.validationData?.message || "Unbekannter Geometrie-Fehler.";
    }
  }

  if (!finalPhotoBuffer) {
    return ctx.reply(`❌ **Automatischer Self-Healing Abbruch:** Die KI konnte die Chart-Topologie für ${cleanSymbol} auch nach 3 mathematischen Korrektur-Zyklen nicht fehlerfrei auflösen.\n\nLetzter Kritiker-Befund:\n*_" ${criticRejectionReason} "_*\n\nBitte Timeframe wechseln oder Rohdaten prüfen.`);
  }

  chatSessions[chatId] = {
    lastDataPayload: { candles: candlesArray, waves: parseWavesFromText(finalResponseText) },
    history: [{ role: "user", text: "Kursdaten analysiert." }, { role: "model", text: finalResponseText }]
  };

  let statusBadge = "";
  try {
      const pyRep = JSON.parse(finalErrLogLog);
      if (pyRep.correction_gate) {
          const cg = pyRep.correction_gate;
          if (cg.is_confirmed) {
              statusBadge = `\n\n🟢 **STATUS:** Laufende Korrektur bestätigt beendet! (Schlusskurs ${cg.current_close.toFixed(2)} USD liegt über der Schranke von ${cg.b_gate_price.toFixed(2)} USD).`;
          } else {
              const gateStr = cg.b_gate_price !== null && cg.b_gate_price !== undefined ? cg.b_gate_price.toFixed(2) : '0.00';
              statusBadge = `\n\n⚠️ **STATUS:** Letzte Abwärtswelle weiterhin AKTIV! (Schlusskurs ${cg.current_close.toFixed(2)} USD notiert unter dem Bestätigungs-Gate von ${gateStr} USD).\n🎯 **BERECHNETE FIBO-ZIELZONE:** ${cg.fib_lower.toFixed(2)} USD bis ${cg.fib_upper.toFixed(2)} USD (Sweetspot: ${cg.fib_sweetspot.toFixed(2)} USD).`;
          }
      }
  } catch(e) {}

  if (isDebug && finalErrLogLog) {
      await ctx.reply(`🩻 **PYTHON TELEMETRIE (Runde ${iteration}):**\n\`\`\`json\n${finalErrLogLog.substring(0, 3800)}\n\`\`\``);
  }

  await ctx.replyWithPhoto({ source: finalPhotoBuffer }, { caption: `📊 EW Self-Healing Master View: ${cleanSymbol} (${finalIntervalLabel}) - Validiert in Runde ${iteration}` });
  
  const fullReport = finalResponseText + statusBadge;
  for (let i = 0; i < fullReport.length; i += 4000) {
      await ctx.reply(fullReport.substring(i, i + 4000));
  }
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
