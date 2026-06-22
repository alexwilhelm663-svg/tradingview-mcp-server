import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V77: God-Mode Clamp & Overlap Auto-Healer aktiv...");

function translateErrorToMathConstraint(errStr: string, atlDate: string, atlPrice: number): string {
  const s = String(errStr);
  if (s.includes("Overlap-Verstoß") || s.includes("dringt illegal in das Gebiet von Gipfel")) {
    const match = s.match(/Gipfel '[^']+' \(([0-9.]+) USD\)/) || s.match(/Gipfel '[^']+' \(([0-9.]+)\)/);
    const limit = match ? match[1] : "den davorliegenden Gipfel";
    return `\n🛑 OVERLAP-REGEL: Welle 4 MUSS zwingend EINE ZAHL STRIKT GRÖSSER ALS ${limit} sein!`;
  }
  if (s.includes("Topologie-Verstoß")) {
    return `\n🛑 TOPOLOGIE-REGEL: Ein Tal (2 oder 4) muss zwingend tiefer liegen als der Gipfel davor!`;
  }
  return "";
}

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

// DER GOD-MODE PARSER: KORRIGIERT AUTONOM
function normalizeAndHealWaves(rawText: string, analysisCandles: any[], atlDate: string, atlPrice: number): { waves: any[] | null, error: string | null } {
  try {
    const clean = rawText.replace(/^```json\s*/g, "").replace(/```\s*$/g, "").trim();
    const data = JSON.parse(clean);

    let rawArray: any[] | null = null;
    if (Array.isArray(data)) rawArray = data;
    else if (data.waves && Array.isArray(data.waves)) rawArray = data.waves;
    else if (data.elliott_wave_structure?.wave_count) rawArray = data.elliott_wave_structure.wave_count;
    else if (data.elliott_wave_count?.cycle_degree) {
      rawArray = Object.entries(data.elliott_wave_count.cycle_degree).map(([k, v]) => ({ wave: k, date: v }));
    } else {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) { rawArray = data[key]; break; }
      }
    }

    if (!rawArray || rawArray.length === 0) return { waves: null, error: "Kein Wellen-Array extrahiert." };

    const list: any[] = [];
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
      if (isNaN(cleanPrice) || cleanPrice === 0) cleanPrice = salvagePriceFromCandles(cleanDate, cleanLabel, analysisCandles);

      if (cleanDate && !isNaN(cleanPrice) && cleanPrice > 0) {
        list.push({ label: cleanLabel, date: cleanDate, price: Number(cleanPrice.toFixed(2)) });
      }
    }

    if (list.length < 3) return { waves: null, error: "Zu wenige Wellen nach Bereinigung." };

    // =================================================================
    // 1. DIE WELLE-0 ZWANGSKLEMME (Gegen Krypto-Erinnerungen)
    // =================================================================
    const w0 = list.find(w => w.label === "0");
    if (w0) {
      w0.date = atlDate;
      w0.price = atlPrice;
    } else {
      list[0].date = atlDate;
      list[0].price = atlPrice;
      list[0].label = "0";
    }

    // =================================================================
    // 2. ZEIT-PARADOXON KILLER
    // =================================================================
    for (const w of list) {
      if (w.date < atlDate) {
        return { waves: null, error: `Zeit-Paradoxon: Welle '${w.label}' liegt am ${w.date} (VOR dem Allzeittief am ${atlDate}).` };
      }
    }

    // =================================================================
    // 3. OVERLAP AUTO-HEALER (Der ARM-Lebensretter)
    // =================================================================
    const w1 = list.find(w => w.label === "1");
    const w3 = list.find(w => w.label === "3");
    const w4 = list.find(w => w.label === "4");
    const w5 = list.find(w => w.label === "5");

    if (w1 && w3 && w4 && w5 && w4.price <= w1.price) {
      // Suche im sauberen Chartfenster zwischen Gipfel 3 und Gipfel 5 nach einem Tal > Gipfel 1
      const safeCandles = analysisCandles.filter(c => c.date > w3.date && c.date < w5.date && parseFloat(c.low) > w1.price);
      if (safeCandles.length > 0) {
        safeCandles.sort((a, b) => parseFloat(a.low) - parseFloat(b.low)); // Tiefstes sicheres Tal
        w4.date = safeCandles[0].date;
        w4.price = parseFloat(safeCandles[0].low);
        console.log(`🩹 [Auto-Heal] Welle 4 autonom auf ${w4.date} (${w4.price}) verschoben! Overlap verhindert.`);
      }
    }

    return { waves: list, error: null };
  } catch (e: any) {
    return { waves: null, error: `Parser-Crash: ${e.message}` };
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

  await ctx.reply(`⏳ God-Mode Kalibrierung: ${cleanSymbol}...`);
  let marketData;
  try { marketData = await fetchVanillaYahooCandles(cleanSymbol); } 
  catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const { fullCandles, analysisCandles, atlDate, atlPrice } = marketData;

  if (analysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlPrice} USD) erst am ${atlDate}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

  const minifiedMarketStream = analysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const fullSystemPrompt = getElliottWaveSystemPrompt(analysisCandles[0].date, analysisCandles[analysisCandles.length-1].date, minifiedMarketStream) + 
    `\n🔥 ZWANGS-ANKER: Welle 0 ist der ${atlDate} (${atlPrice}).`;
  
  const manualChatHistory: any[] = [];
  let iteration = 0;
  let pythonVetoReason = "";
  let finalPhoto: Buffer | null = null;

  while (iteration < 3) {
    iteration++;
    try {
      const currentTemp = iteration === 1 ? 0.1 : (iteration === 2 ? 0.35 : 0.65);
      const dynamicModel = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite", 
        systemInstruction: fullSystemPrompt,
        generationConfig: { responseMimeType: "application/json", temperature: currentTemp }
      });

      let promptText = iteration === 1 
        ? `Generiere die Elliott-Wellen-Zählung als JSON mit dem Array "waves".`
        : `🔴 REGEL-VETO DER PYTHON-ENGINE!\nGrund:\n"${pythonVetoReason}"\n${translateErrorToMathConstraint(pythonVetoReason, atlDate, atlPrice)}\nGeneriere ein korrigiertes JSON.`;

      const response = await dynamicModel.generateContent({
        contents: [...manualChatHistory, { role: "user", parts: [{ text: promptText }] }]
      });

      const rawLlmAnswer = response.response.text();
      manualChatHistory.push({ role: "user", parts: [{ text: promptText }] });
      manualChatHistory.push({ role: "model", parts: [{ text: rawLlmAnswer }] });

      // GOD MODE PARSER (KORRIGIERT WELLE 0 & OVERLAPS AUTONOM)
      const normalization = normalizeAndHealWaves(rawLlmAnswer, analysisCandles, atlDate, atlPrice);
      
      if (!normalization.waves) {
        pythonVetoReason = normalization.error!;
        continue;
      }

      const py = await runPythonCritic(cleanSymbol, normalization.waves, fullCandles);
      if (py.pngBuffer) {
        finalPhoto = py.pngBuffer;
        break; 
      }

      pythonVetoReason = py.errorMessage || "Topologie-Verstoß";
      await ctx.reply(`🔄 [Runde ${iteration}] Python sagt: ${pythonVetoReason.substring(0, 100)}`);

    } catch(e: any) {
        if (e.message.includes("503")) {
          await ctx.reply(`⏳ Google-Server überlastet (503). Warte 3 Sekunden...`);
          await new Promise(r => setTimeout(r, 3000));
        } else {
          await ctx.reply(`⚠️ API-Fehler: ${e.message}`);
        }
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
