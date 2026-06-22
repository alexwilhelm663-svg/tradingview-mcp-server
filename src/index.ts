import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V76: The Thermal-Jiggle & Wick-Snap Apex Engine aktiv...");

function translateErrorToMathConstraint(errStr: string, atlDate: string, atlPrice: number): string {
  const s = String(errStr);
  
  if (s.includes("Overlap-Verstoß") || s.includes("dringt illegal in das Gebiet von Gipfel")) {
    const match = s.match(/Gipfel '[^']+' \(([0-9.]+) USD\)/) || s.match(/Gipfel '[^']+' \(([0-9.]+)\)/);
    const limit = match ? match[1] : "den davorliegenden Gipfel";
    return `\n🛑 OVERLAP-REGEL: Welle 4 MUSS zwingend EINE ZAHL STRIKT GRÖSSER ALS ${limit} sein! Wähle ein höheres Chart-Tal!`;
  }

  if (s.includes("Retracement-Bruch") || s.includes("fällt tiefer als der Nullpunkt")) {
    return `\n🛑 RETRACEMENT-REGEL: Welle 2 darf niemals tiefer fallen als Welle 0 (${atlPrice}). Setze Welle '0' zwingend auf den ${atlDate}!`;
  }

  if (s.includes("Topologie-Verstoß") || s.includes("notiert höher oder gleich")) {
    return `\n🛑 TOPOLOGIE-REGEL: Ein Korrektur-Tal (Welle 2 oder 4) MUSS zwingend einen TIEFEREN Kurs haben als der Gipfel davor (Welle 1 oder 3)! Du hast ein Tal über einen Gipfel gelegt. Wähle für das Tal einen kleineren Zahlenwert!`;
  }

  return "";
}

// WICK-SNAP SALVAGER: Greift bei Gipfeln das High, bei Tälern das Low!
function salvagePriceFromCandles(dateStr: string, waveLabel: string, candles: any[]): number {
  const target = String(dateStr).substring(0, 10);
  const match = candles.find(c => c.date === target);
  if (!match) return 0.0;

  const cleanL = String(waveLabel).trim().toLowerCase();
  const isPeak = ["1", "3", "5", "b"].includes(cleanL);
  const isValley = ["0", "2", "4", "a", "c"].includes(cleanL);

  if (isPeak && match.high !== undefined) return parseFloat(match.high);
  if (isValley && match.low !== undefined) return parseFloat(match.low);
  return parseFloat(match.close);
}

// KORREKTUR DES DATENLECKS: Normalisiert jetzt NUR noch gegen die amputierten Kerzen!
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
      
      if (isNaN(cleanPrice) || cleanPrice === 0) {
        // HIER GREIFT DER DOCHT-SNAP
        cleanPrice = salvagePriceFromCandles(cleanDate, cleanLabel, candles);
      }

      if (cleanDate && !isNaN(cleanPrice) && cleanPrice > 0) {
        normalizedWaves.push({ label: cleanLabel, date: cleanDate, price: Number(cleanPrice.toFixed(2)) });
      }
    }

    if (normalizedWaves.length < 3) return { waves: null, error: `Zu wenige Wellen nach Normalisierung.` };
    return { waves: normalizedWaves, error: null };
  } catch (e: any) {
    return { waves: null, error: `JSON-Parser Crash: ${e.message}` };
  }
}

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
      atlIndex = rawCandles.length; 
    }

    rawCandles.push({
      date: dateStr,
      open: Number(quote.open[i]).toFixed(4),
      high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4),
      close: Number(quote.close[i]).toFixed(4)
    });
  }

  const bullCycleCandles = rawCandles.slice(atlIndex);

  return { 
    fullCandles: rawCandles,       
    analysisCandles: bullCycleCandles, 
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

  await ctx.reply(`⏳ Stream-Amputation & Docht-Kalibrierung: ${cleanSymbol}...`);
  let marketData;
  try { 
    marketData = await fetchVanillaYahooCandles(cleanSymbol); 
  } catch (e: any) { 
    return ctx.reply(`❌ Download: ${e.message}`); 
  }

  const { fullCandles, analysisCandles, atlDate, atlPrice } = marketData;

  if (analysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlPrice} USD) erst am ${atlDate}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

  const minifiedMarketStream = analysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  
  const TOPOLOGY_LAW_PROMPT = `
\n==================================================================
🔥 DIE EISERNEN GESETZE DER GEOMETRIE 🔥
1. Welle 0 MUSS der ${atlDate} (${atlPrice}) sein!
2. Welle 1, 3 und 5 sind GIPFEL (Highs). Ihr Kurs MUSS markant hoch sein!
3. Welle 2 und 4 sind TÄLER (Lows). Ihr Kurs MUSS zwingend tiefer liegen als der Gipfel davor!
Es ist mathematisch STRICT VERBOTEN, dass ein Tal (2 oder 4) preislich >= seinem Gipfel (1 oder 3) ist.
==================================================================`;

  const fullSystemPrompt = getElliottWaveSystemPrompt(analysisCandles[0].date, analysisCandles[analysisCandles.length-1].date, minifiedMarketStream) + TOPOLOGY_LAW_PROMPT;
  
  // Wir steuern die History manuell, um die Temperatur pro Runde hochzuschrauben!
  const manualChatHistory: any[] = [];
  let iteration = 0;
  let pythonVetoReason = "";
  let finalPhoto: Buffer | null = null;

  while (iteration < 3) {
    iteration++;
    try {
      // THERMAL JIGGLE: Wir erhöhen die thermische Unruhe pro Veto!
      const currentTemp = iteration === 1 ? 0.1 : (iteration === 2 ? 0.35 : 0.65);
      
      const dynamicModel = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite", 
        systemInstruction: fullSystemPrompt,
        generationConfig: { responseMimeType: "application/json", temperature: currentTemp }
      });

      let promptText = "";
      if (iteration === 1) {
        promptText = `Generiere die Elliott-Wellen-Zählung als JSON mit dem Array "waves". Denke an die Topologie (Tal < Gipfel)!`;
      } else {
        const mathTutorConstraint = translateErrorToMathConstraint(pythonVetoReason, atlDate, atlPrice);
        promptText = `🔴 REGEL-VETO DER PYTHON-ENGINE!\n\nGrund der Ablehnung:\n"${pythonVetoReason}"\n${mathTutorConstraint}\n\nGeneriere ein NEUES, zwingend korrigiertes JSON.`;
      }

      const response = await dynamicModel.generateContent({
        contents: [...manualChatHistory, { role: "user", parts: [{ text: promptText }] }]
      });

      const rawLlmAnswer = response.response.text();
      
      manualChatHistory.push({ role: "user", parts: [{ text: promptText }] });
      manualChatHistory.push({ role: "model", parts: [{ text: rawLlmAnswer }] });

      // KORREKTUR: Wir normalisieren strikt gegen die amputierten analysisCandles!
      const normalization = normalizeLlmOutput(rawLlmAnswer, analysisCandles);
      
      if (!normalization.waves) {
        pythonVetoReason = normalization.error!;
        continue;
      }

      // Python bekommt die sauberen Wellen, aber die FULL CANDLES zum Zeichnen
      const py = await runPythonCritic(cleanSymbol, normalization.waves, fullCandles);
      if (py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break; 
      }

      pythonVetoReason = py.errorMessage || "Topologie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration} | Temp ${currentTemp}] Python sagt: ${pythonVetoReason.substring(0, 100)}`);

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
