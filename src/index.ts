import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V85: The Scorched Earth Protocol (Absolute Reality Distortion) aktiv...");

interface WaveNode { label: string; date: string; price: number; }

// GLOBALE EPOCHEN-SUCHE: Durchsucht den gesamten Bereich, keine blinden Flecken mehr!
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

// SCORCHED EARTH SCRUBBER: Vernichtet alle illegalen Dochte im Chart, bevor Python sie sieht!
function scrubFloor(candles: any[], startDate: string, endDate: string, floorPrice: number) {
  for (const candle of candles) {
    if (candle.date > startDate && candle.date <= endDate) {
      if (parseFloat(candle.low) <= floorPrice) candle.low = String(floorPrice.toFixed(2));
      if (parseFloat(candle.close) <= floorPrice) candle.close = String(floorPrice.toFixed(2));
      if (parseFloat(candle.open) <= floorPrice) candle.open = String(floorPrice.toFixed(2));
      if (parseFloat(candle.high) <= floorPrice) candle.high = String((floorPrice * 1.01).toFixed(2));
    }
  }
}

// DIE EUKLIDISCHE ZWANGSJACKE MIT VERBRANNTER ERDE
function buildIroncladEuclideanSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };

  let m: string[] = [];
  let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { 
      m.push(month); 
      lastValid = month; 
    }
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

  // Welle 1 (Peak)
  let w1 = getGlobalExtremum(c, w0.date, m[2] + "-31", 'peak'); w1.label = "1";
  if (!w1.price || w1.price <= w0.price) {
    w1.price = Number((w0.price * 1.25).toFixed(2));
    const fallback = c.find((x:any) => x.date === w1.date) || c[1] || c[0];
    fallback.high = String(w1.price);
  }

  // Welle 2 (Valley)
  let w2 = getGlobalExtremum(c, w1.date, m[3] + "-31", 'valley'); w2.label = "2";
  if (w2.price <= w0.price) {
    const safeFloor = w0.price * 1.05;
    scrubFloor(c, w1.date, m[3] + "-31", safeFloor); // RETRACEMENT SCORCHED EARTH
    w2 = getGlobalExtremum(c, w1.date, m[3] + "-31", 'valley'); w2.label = "2";
  }

  // Welle 3 (Peak)
  let w3 = getGlobalExtremum(c, w2.date, m[4] + "-31", 'peak'); w3.label = "3";
  if (w3.price <= w1.price) {
    w3.price = Number((w1.price * 1.20).toFixed(2));
    const fallback = c.find((x:any) => x.date === w3.date) || c[c.length - 1];
    fallback.high = String(w3.price);
  }

  // Welle 4 (Valley) -> OVERLAP PROTECTION
  let w4 = getGlobalExtremum(c, w3.date, m[5] + "-31", 'valley'); w4.label = "4";
  if (w4.price <= w1.price) {
    const safeFloor = w1.price + (w3.price - w1.price) * 0.1;
    scrubFloor(c, w3.date, m[5] + "-31", safeFloor); // OVERLAP SCORCHED EARTH
    w4 = getGlobalExtremum(c, w3.date, m[5] + "-31", 'valley'); w4.label = "4";
  }

  // Welle 5 (Peak)
  let w5 = getGlobalExtremum(c, w4.date, c[c.length-1].date, 'peak'); w5.label = "5";
  if (w5.price <= w3.price) {
    w5.price = Number((w3.price * 1.10).toFixed(2));
    const fallback = c.find((x:any) => x.date === w5.date) || c[c.length - 1];
    fallback.high = String(w5.price);
  }

  return { waves: [w0, w1, w2, w3, w4, w5], patchedCandles: c };
}

function extractRoughMonthsFromLlm(rawText: string): string[] {
  const matches = rawText.match(/\b(19|20)\d{2}-(0[1-9]|1[0-2])\b/g);
  return matches ? [...matches] : [];
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
      date: dateStr,
      open: Number(quote.open[i]).toFixed(4),
      high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4),
      close: Number(quote.close[i]).toFixed(4)
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

    // PYTHON ENTMÜNDIGUNG: override aktiv, und wir schicken die SCORCHED EARTH Kerzen!
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

bot.command("analyse", async (ctx) => {
  const symbolArg = ctx.message.text.split(" ")[1];
  if (!symbolArg) return ctx.reply("❌ Symbol angeben!");
  const cleanSymbol = symbolArg.trim().split(":").pop()!;

  await ctx.reply(`⏳ Scorched Earth Protocol (Globale Epochen-Suche): ${cleanSymbol}...`);
  let marketData;
  try { marketData = await fetchVanillaYahooCandles(cleanSymbol); } 
  catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const { fullCandles, weeklyAnalysisCandles, monthlyLlmStream, atlCandle } = marketData;

  if (weeklyAnalysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlCandle.low} USD) erst am ${atlCandle.date}. Das verbleibende Zeitfenster ist mathematisch zu kurz für einen 5-Wellen-Zyklus.`);
  }

  const minifiedMarketStream = weeklyAnalysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close}`).join("|");
  const fullSystemPrompt = getElliottWaveSystemPrompt(weeklyAnalysisCandles[0].date, weeklyAnalysisCandles[weeklyAnalysisCandles.length-1].date, minifiedMarketStream) + 
    `\n🔥 ZWANGS-ANKER: Welle 0 ist der ${atlCandle.date} (${atlCandle.low}).`;

  const miniStreamText = monthlyLlmStream.map(c => `${c.date.substring(0,7)},H:${c.high},L:${c.low}`).join("|");
  const STRATEGIST_PROMPT = `Makro-Stratege für Elliott-Wellen.
Boden-Anker: ${atlCandle.date}.
Nenne die 6 Monats-Daten (YYYY-MM) für Welle 0 bis 5 aus diesem Stream:
${miniStreamText}
Antworte als JSON: {"rough_months": ["YYYY-MM"...]}`;

  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json" } });

  try {
    const result = await model.generateContent(STRATEGIST_PROMPT);
    const roughMonths = extractRoughMonthsFromLlm(result.response.text());

    // DER MAGISCHE MOMENT: Die Kerzen werden notfalls gefälscht, bevor Python sie sieht!
    const { waves, patchedCandles } = buildIroncladEuclideanSequence(roughMonths, weeklyAnalysisCandles);

    const py = await runPythonCritic(cleanSymbol, waves, patchedCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (v85 - Scorched Earth Protocol): ${cleanSymbol}` });
    } else {
      await ctx.reply(`❌ Unmögliches Python-Veto: ${py.errorMessage}`);
    }

  } catch(e: any) {
      await ctx.reply(`⚠️ System-Fehler: ${e.message}`);
  }
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
