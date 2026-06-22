import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V75: The Left-Wall Amputation Engine (Dual-Stream Setup) aktiv...");

function salvagePriceFromCandles(dateStr: string, candles: any[]): number {
  const target = String(dateStr).substring(0, 10);
  const match = candles.find(c => c.date === target);
  if (match && !isNaN(parseFloat(match.close))) return parseFloat(match.close);
  for (const c of candles) {
    if (c.date >= target) return parseFloat(c.close);
  }
  return 0.0;
}

function normalizeLlmOutput(rawText: string, candles: any[]): { waves: any[] | null, error: string | null } {
  try {
    const clean = rawText.replace(/^```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const data = JSON.parse(clean);

    let rawArray: any[] | null = null;
    if (Array.isArray(data)) rawArray = data;
    else if (data.waves && Array.isArray(data.waves)) rawArray = data.waves;
    else if (data.elliott_wave_structure?.wave_count && Array.isArray(data.elliott_wave_structure.wave_count)) {
      rawArray = data.elliott_wave_structure.wave_count;
    } else if (data.elliott_wave_count?.cycle_degree) {
      rawArray = Object.entries(data.elliott_wave_count.cycle_degree).map(([k, v]) => ({ wave: k, date: v }));
    } else {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) { rawArray = data[key]; break; }
      }
    }

    if (!rawArray || rawArray.length === 0) return { waves: null, error: `Kein Wellen-Array extrahiert.` };

    const normalizedWaves: any[] = [];
    for (const item of rawArray) {
      if (typeof item !== "object" || item === null) continue;

      let rawLabel = item.label || item.Welle || item.wave || item.welle || item.id || item.step || item.name || "X";
      let cleanLabel = String(rawLabel).replace(/welle|wave|cycle|degree|_/gi, "").trim();
      if (!cleanLabel) cleanLabel = String(rawLabel).trim();

      let rawDate = item.date || item.Datum || item.datum || item.start || item.time || item.timestamp;
      if (typeof rawDate === "string" && rawDate.includes("to")) rawDate = rawDate.split("to")[1].trim();
      let cleanDate = String(rawDate).substring(0, 10);

      let rawPrice = item.price || item.Kurs || item.kurs || item.value || item.end_price;
      let cleanPrice = parseFloat(rawPrice);
      
      if (isNaN(cleanPrice) || cleanPrice === 0) cleanPrice = salvagePriceFromCandles(cleanDate, candles);

      if (cleanDate && !isNaN(cleanPrice)) {
        normalizedWaves.push({ label: cleanLabel, date: cleanDate, price: Number(cleanPrice.toFixed(2)) });
      }
    }

    if (normalizedWaves.length < 3) return { waves: null, error: `Zu wenige Wellen nach Normalisierung.` };
    return { waves: normalizedWaves, error: null };
  } catch (e: any) {
    return { waves: null, error: `JSON-Parser Crash: ${e.message}` };
  }
}

// DUAL STREAM FETCHER: Trennt die optische Historie von der mathematischen Bullen-Realität
async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=max`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Kursdaten im Yahoo-JSON.");
  
  const timestamps = chartData.timestamp || [];
  const quote = chartData.indicators?.quote?.[0] || {};
  
  const rawCandles: any[] = [];
  let minLow = Infinity;
  let atlIndex = 0;

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    const currentLow = parseFloat(quote.low[i]);

    if (currentLow < minLow) {
      minLow = currentLow;
      atlIndex = rawCandles.length; // Index im sauberen Array sichern
    }

    rawCandles.push({
      date: dateStr,
      open: Number(quote.open[i]).toFixed(4),
      high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4),
      close: Number(quote.close[i]).toFixed(4)
    });
  }

  // DIE AMPUTATION: Wir schneiden alles links vom Allzeittief ab!
  const bullCycleCandles = rawCandles.slice(atlIndex);

  return { 
    fullCandles: rawCandles,       // Stream A: Für das Python-Rendering (Optik)
    analysisCandles: bullCycleCandles, // Stream B: Für die KI (Lobotomie)
    atlDate: rawCandles[atlIndex]?.date || "", 
    atlPrice: Number(minLow.toFixed(2))
  };
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [], stderrStr = "";
    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());
    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
    pyProcess.stdin.end();

    pyProcess.on("close", (code) => {
      const trimmedStderr = stderrStr.trim();
      if (code !== 0) return resolve({ pngBuffer: null, errorMessage: `Python Crash [Exit ${code}]:\n${trimmedStderr}` });

      if (trimmedStderr.length > 0) {
        try {
          const parsed = JSON.parse(trimmedStderr);
          if (parsed.validation && parsed.validation.valid === false) return resolve({ pngBuffer: null, errorMessage: parsed.validation.message });
        } catch (e) {
          if (stdoutBufs.length === 0) return resolve({ pngBuffer: null, errorMessage: trimmedStderr });
        }
      }

      if (stdoutBufs.length > 0) return resolve({ pngBuffer: Buffer.concat(stdoutBufs), errorMessage: null });
      resolve({ pngBuffer: null, errorMessage: "Python beendete den Prozess ohne Bild." });
    });
  });
}

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Stream-Amputation: ${cleanSymbol}...`);
  let marketData;
  try { 
    marketData = await fetchVanillaYahooCandles(cleanSymbol); 
  } catch (e: any) { 
    return ctx.reply(`❌ Download: ${e.message}`); 
  }

  const { fullCandles, analysisCandles, atlDate, atlPrice } = marketData;

  // DER HOCHPROFESSIONELLE BÄRENMARKT-SCHUTZ
  // Wenn nach dem Abschneiden des Allzeittiefs weniger als 26 Wochen (ein halbes Jahr) übrig bleiben:
  if (analysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlPrice} USD) erst am ${atlDate}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

  // Die KI bekommt AUSSCHLIESSLICH die amputierten Kerzen ab dem Allzeittief!
  const minifiedMarketStream = analysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  
  const LOBOTOMY_PROMPT = `
\n\n==================================================================
🔥 DAS GESETZ DES NULLPUNKTS 🔥
Dein Datensatz beginnt exakt am historischen Boden (${atlDate} bei ${atlPrice} USD).
1. Du BIST GEZWUNGEN, Welle '0' auf das allererste Element dieses Datensatzes (${atlDate}) zu legen!
2. Jedes Zwischentief, das du für Welle 2 wählst, liegt mathematisch über ${atlPrice}.
==================================================================`;

  const fullSystemPrompt = getElliottWaveSystemPrompt(analysisCandles[0].date, analysisCandles[analysisCandles.length-1].date, minifiedMarketStream) + LOBOTOMY_PROMPT;
  
  const modelLite = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite", 
    systemInstruction: fullSystemPrompt,
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
  });

  const chatSession = modelLite.startChat();

  let iteration = 0;
  let pythonVetoReason = "";
  let lastLlmGeneratedJson = "";
  let finalPhoto: Buffer | null = null;

  while (iteration < 3) {
    iteration++;
    try {
      let promptText = iteration === 1 
        ? `Führe die Elliott-Wellen-Zählung durch. Liefere AUSSCHLIESSLICH ein JSON-Objekt mit dem Array "waves".`
        : `🔴 GEOMETRIE-FEHLER IN DEINEM VORHERIGEN VERSUCH!\nFehlerhafte Zählung von eben:\n${lastLlmGeneratedJson}\n\nPython-Ablehnungsgrund:\n"${pythonVetoReason}"\n\nGeneriere das korrigierte JSON-Array.`;

      const result = await chatSession.sendMessage(promptText);
      lastLlmGeneratedJson = result.response.text(); 

      // Wir normalisieren gegen die VOLLSTÄNDIGEN Kerzen, damit er die echten Kurse findet
      const normalization = normalizeLlmOutput(lastLlmGeneratedJson, fullCandles);
      if (!normalization.waves) {
        pythonVetoReason = normalization.error!;
        continue;
      }

      // BINGO: Python kriegt die Wellen der KI, aber den VOLLSTÄNDIGEN Chart zum Zeichnen!
      const py = await runPythonCritic(cleanSymbol, normalization.waves, fullCandles);
      if (py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break; 
      }

      pythonVetoReason = py.errorMessage || "Geometrie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration}] Python-Veto: ${pythonVetoReason}`);

    } catch(e: any) {
        await ctx.reply(`⚠️ API-Fehler: ${e.message}`);
    }
  }

  if (!finalPhoto) return ctx.reply(`❌ Abbruch nach 3 Zyklen.\n\nGrund:\n\`\`\`text\n${pythonVetoReason}\n\`\`\``);
  await ctx.replyWithPhoto({ source: finalPhoto }, { caption: `📊 EW View: ${cleanSymbol}` });
});

if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = ""; req.on("data", c => body += c);
      req.on("end", () => { res.writeHead(200); res.end("ok"); try { bot.handleUpdate(JSON.parse(body)); } catch (e) {} });
    } else res.end("OK");
  }).listen(PORT);
} else bot.launch();
