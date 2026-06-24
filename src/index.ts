import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V98: Hunter-Killer Radar & Autonomous Scanning aktiv...");

// ============================================================================
// WATCHLIST FÜR DEN RADAR-SCAN (Beliebig erweiterbar)
// ============================================================================
const WATCHLIST = ["AAPL", "NVDA", "TSLA", "ARM", "PLTR", "IONQ", "MSTR", "AMD", "GOOGL"];

interface WaveNode { label: string; date: string; price: number; }

function getGlobalExtremum(candles: any[], startDate: string, endDate: string, mode: 'peak'|'valley'): WaveNode {
  const window = candles.filter(c => c.date > startDate && c.date <= endDate);
  if (window.length === 0) return { label: "", date: endDate, price: 0 };
  let best = window[0];
  if (mode === 'peak') {
    for (const c of window) if (parseFloat(c.high) > parseFloat(best.high)) best = c;
    return { label: "", date: best.date, price: parseFloat(best.high) };
  } else {
    for (const c of window) if (parseFloat(c.low) < parseFloat(best.low)) best = c;
    return { label: "", date: best.date, price: parseFloat(best.low) };
  }
}

function buildIroncladEuclideanSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };
  let m: string[] = [];
  let lastValid = "";
  
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { m.push(month); lastValid = month; }
  }

  if (m.length < 6) {
    const lastIdx = m.length > 0 ? c.findIndex((x:any) => x.date.startsWith(m[m.length-1])) : 0;
    const safeLastIdx = Math.max(0, lastIdx);
    const remainingCandles = c.length - 1 - safeLastIdx;
    const missingSlots = 6 - m.length;
    const step = Math.max(1, Math.floor(remainingCandles / (missingSlots + 1)));
    for (let i = 1; i <= missingSlots; i++) {
      const nextIdx = Math.min(c.length - 1, safeLastIdx + (i * step));
      m.push(c[nextIdx].date.substring(0, 7));
    }
  }

  let w1 = getGlobalExtremum(c, w0.date, m[2] + "-31", 'peak'); w1.label = "1";
  let w2 = getGlobalExtremum(c, w1.date, m[3] + "-31", 'valley'); w2.label = "2";
  if (w2.price <= w0.price) throw new Error("RETRACEMENT_VIOLATION");
  let w3 = getGlobalExtremum(c, w2.date, m[4] + "-31", 'peak'); w3.label = "3";
  let w4 = getGlobalExtremum(c, w3.date, m[5] + "-31", 'valley'); w4.label = "4";
  if (w4.price <= w1.price) throw new Error("OVERLAP_VIOLATION");
  let w5 = getGlobalExtremum(c, w4.date, c[c.length-1].date, 'peak'); w5.label = "5";

  const finalWaves: WaveNode[] = [w0, w1, w2, w3, w4, w5];
  const postW5Candles = c.filter((x:any) => x.date > w5.date);
  
  if (postW5Candles.length > 15) {
    let wC = getGlobalExtremum(c, w5.date, c[c.length-1].date, 'valley'); wC.label = "C";
    let wB = getGlobalExtremum(c, w5.date, wC.date, 'peak'); wB.label = "B";
    let wA = getGlobalExtremum(c, w5.date, wB.date, 'valley'); wA.label = "A";
    if (wA.date > w5.date && wB.date > wA.date && wC.date > wB.date) finalWaves.push(wA, wB, wC);
  }
  return { waves: finalWaves, patchedCandles: c };
}

function buildUpwardCorrectionSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };
  let m: string[] = [];
  let lastValid = "";
  
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { m.push(month); lastValid = month; }
  }
  while (m.length < 4) m.push(c[c.length - 1].date.substring(0, 7));

  let wA = getGlobalExtremum(c, w0.date, m[1] + "-31", 'peak'); wA.label = "A";
  let wB = getGlobalExtremum(c, wA.date, m[2] + "-31", 'valley'); wB.label = "B";
  let wC = getGlobalExtremum(c, wB.date, c[c.length-1].date, 'peak'); wC.label = "C";
  return { waves: [w0, wA, wB, wC], patchedCandles: c };
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
  const seenDates = new Set<string>();

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    if (seenDates.has(dateStr)) continue;
    seenDates.add(dateStr);
    const currentLow = parseFloat(quote.low[i]);
    if (currentLow < minLow) { minLow = currentLow; atlIndex = rawCandles.length; }
    rawCandles.push({
      date: dateStr, open: Number(quote.open[i]).toFixed(4), high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4), close: Number(quote.close[i]).toFixed(4)
    });
  }

  const bullCycleCandles = rawCandles.slice(atlIndex);
  const monthlyCompressed: any[] = [];
  let lastMonth = "";
  for (const c of bullCycleCandles) {
    const m = c.date.substring(0, 7);
    if (m !== lastMonth) { monthlyCompressed.push(c); lastMonth = m; }
  }
  return { fullCandles: rawCandles, weeklyAnalysisCandles: bullCycleCandles, monthlyLlmStream: monthlyCompressed, atlCandle: rawCandles[atlIndex] };
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [], stderrStr = "";
    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    const payload = { symbol, waves, candles, validate: false, strict: false, override: true };
    pyProcess.stdin.write(JSON.stringify(payload));
    pyProcess.stdin.end();

    pyProcess.on("close", (code) => {
      const trimmedStderr = stderrStr.trim();
      if (code !== 0) return resolve({ pngBuffer: null, errorMessage: `Python Crash:\n${trimmedStderr}` });
      if (stdoutBufs.length > 0) return resolve({ pngBuffer: Buffer.concat(stdoutBufs), errorMessage: null });
      resolve({ pngBuffer: null, errorMessage: trimmedStderr || "Python beendete den Prozess ohne Bild." });
    });
  });
}

// ============================================================================
// CORE ANALYSE-ENGINE (Refaktoriert für Einzelaufrufe & Radar-Loops)
// ============================================================================
async function analyzeAsset(symbol: string, silentLogging = false) {
  const marketData = await fetchVanillaYahooCandles(symbol);
  const { fullCandles, weeklyAnalysisCandles, atlCandle } = marketData;

  if (weeklyAnalysisCandles.length < 26) throw new Error("Säkulares Bärenmarkt-Veto (Historie zu kurz).");

  const minifiedMarketStream = weeklyAnalysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const fullSystemPrompt = getElliottWaveSystemPrompt(weeklyAnalysisCandles[0].date, weeklyAnalysisCandles[weeklyAnalysisCandles.length-1].date, minifiedMarketStream) + 
    `\n🔥 ZWANGS-ANKER: Welle 0 ist der ${atlCandle.date} (${atlCandle.low}).`;

  let basePrompt = `Analysiere die Daten, entscheide den macro_trend und liefere das JSON.`;
  let currentPrompt = basePrompt;

  let attempts = 0;
  const maxAttempts = 3;
  let waves: WaveNode[] = [];
  let patchedCandles: any[] = [];
  let finalTrend = "IMPULSE_UP";
  let currentTemp = 0.0; 

  while (attempts < maxAttempts) {
    attempts++;
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json", temperature: currentTemp } });
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: currentPrompt }] }], systemInstruction: { role: "system", parts: [{ text: fullSystemPrompt }] } });
    
    let parsed = { macro_trend: "IMPULSE_UP", rough_months: [] as string[] };
    const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);

    finalTrend = parsed.macro_trend;

    if (finalTrend === "CORRECTION_UP") {
        const res = buildUpwardCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
        waves = res.waves; patchedCandles = res.patchedCandles;
        break;
    } else {
        try {
            const res = buildIroncladEuclideanSequence(parsed.rough_months, weeklyAnalysisCandles);
            waves = res.waves; patchedCandles = res.patchedCandles;
            break; 
        } catch (e: any) {
            if (e.message === "OVERLAP_VIOLATION" || e.message === "RETRACEMENT_VIOLATION") {
                if (attempts < maxAttempts) {
                    currentTemp += 0.35; 
                    currentPrompt = `${basePrompt}\n\nACHTUNG! FEHLER:\n${e.message}\nWÄHLE ANDERE MONATE!`;
                } else {
                    finalTrend = "CORRECTION_UP";
                    const res = buildUpwardCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
                    waves = res.waves; patchedCandles = res.patchedCandles;
                    break;
                }
            } else throw e; 
        }
    }
  }

  const py = await runPythonCritic(symbol, waves, patchedCandles);
  if (!py.pngBuffer) throw new Error(`Python Veto: ${py.errorMessage}`);

  // KILL-ZONE BERECHNUNG
  const currentPrice = parseFloat(weeklyAnalysisCandles[weeklyAnalysisCandles.length - 1].close);
  let isHotSetup = false;
  let killZoneStatus = "";

  if (finalTrend === "IMPULSE_UP" && waves.length >= 6) {
      const w0 = waves[0].price;
      const w4 = waves[4].price;
      const w5 = waves[5].price;
      const diff = w5 - w0;
      const fib382 = w5 - (0.382 * diff);
      
      // Wenn der Kurs unter das 38.2er Fib gefallen ist, aber noch über dem Tief von Welle 4 liegt
      if (currentPrice <= fib382 && currentPrice >= (w4 * 0.8)) {
          isHotSetup = true;
          killZoneStatus = `🚨 **HOT SETUP:** Kurs (${currentPrice}$) befindet sich in der Macro Kill-Zone!`;
      }
  }

  return { buffer: py.pngBuffer, finalTrend, isHotSetup, killZoneStatus };
}

// ============================================================================
// BOT BEFEHLE
// ============================================================================

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol angeben! Bsp: /analyse AAPL");
  const cleanSymbol = symbolArg.trim().toUpperCase();

  await ctx.reply(`⏳ V98 Analyse: ${cleanSymbol}...`);
  try {
      const result = await analyzeAsset(cleanSymbol);
      let caption = `📊 EW Master (${result.finalTrend}): ${cleanSymbol}`;
      if (result.isHotSetup) caption += `\n\n${result.killZoneStatus}`;
      await ctx.replyWithPhoto({ source: result.buffer }, { caption });
  } catch (e: any) {
      await ctx.reply(`⚠️ Fehler bei ${cleanSymbol}: ${e.message}`);
  }
});

bot.command("radar", async (ctx) => {
  await ctx.reply(`📡 **RADAR AKTIVIERT**\nScanne ${WATCHLIST.length} Tech-Werte im Hintergrund auf 'Macro Kill-Zone' Setups.\nIch melde mich nur, wenn ich ein Setup finde!`);
  
  let hits = 0;
  for (const sym of WATCHLIST) {
      try {
          // Kurzer Delay um Rate-Limits der API zu schonen
          await new Promise(resolve => setTimeout(resolve, 2000)); 
          const result = await analyzeAsset(sym, true);
          
          if (result.isHotSetup && result.finalTrend === "IMPULSE_UP") {
              hits++;
              await ctx.replyWithPhoto({ source: result.buffer }, { 
                  caption: `🎯 **RADAR HIT: ${sym}**\n${result.killZoneStatus}\nPerfektes Setup für einen langfristigen Einstieg.` 
              });
          }
      } catch (e) {
          console.log(`[RADAR SKIP] ${sym} übersprungen: ${e}`);
      }
  }

  await ctx.reply(`🏁 **RADAR ABGESCHLOSSEN**\nScan beendet. Setups gefunden: ${hits}/${WATCHLIST.length}`);
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
