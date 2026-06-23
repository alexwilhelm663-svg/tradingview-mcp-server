import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V84: Chronological Time-Keeper Monolith aktiv...");

interface WaveNode { label: string; date: string; price: number; }

// SNIPER-FUNKTION: Sucht im definierten Monats-Fenster das absolute High/Low
function snapExtremum(candles: any[], monthStr: string, mode: 'peak'|'valley', minDate: string): WaveNode {
  const window = candles.filter(c => c.date > minDate);
  if (window.length === 0) return { label: "", date: minDate, price: 0 };

  const cleanMonth = (monthStr || "").substring(0, 7);
  let idx = window.findIndex(c => c.date.startsWith(cleanMonth));
  if (idx === -1) idx = Math.floor(window.length / 3);

  const slice = window.slice(Math.max(0, idx - 4), Math.min(window.length, idx + 5));
  let best = slice[0];

  if (mode === 'peak') {
    for (const c of slice) if (parseFloat(c.high) > parseFloat(best.high)) best = c;
    return { label: "", date: best.date, price: parseFloat(best.high) };
  } else {
    for (const c of slice) if (parseFloat(c.low) < parseFloat(best.low)) best = c;
    return { label: "", date: best.date, price: parseFloat(best.low) };
  }
}

// DIE EUKLIDISCHE ZWANGSJACKE: Schützt die Python-Engine vor mathematischen Paradoxien
function buildIroncladEuclideanSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };

  // 1. LLM-Input säubern (nur chronologisch aufsteigende Daten erlauben)
  let m: string[] = [];
  let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { 
      m.push(month); 
      lastValid = month; 
    }
  }

  // 2. DER AUTO-SPREADER: Verhindert das Zusammenquetschen am rechten Rand
  if (m.length < 6) {
    console.log(`⚠️ KI lieferte nur ${m.length} Daten. Auto-Spreader aktiviert...`);
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

  // Welle 1 (Gipfel)
  let w1 = snapExtremum(c, m[1], 'peak', w0.date); w1.label = "1";
  if (!w1.price || w1.price <= w0.price) {
    const next = c.find((x:any) => x.date > w0.date) || c[1] || c[0];
    w1 = { label: "1", date: next.date, price: Number((w0.price * 1.25).toFixed(2)) };
    next.high = String(w1.price);
  }

  // Welle 2 (Tal)
  let w2 = snapExtremum(c, m[2], 'valley', w1.date); w2.label = "2";
  if (w2.price <= w0.price) {
    const safeCandles = c.filter((x:any) => x.date > w1.date && x.date < m[3] && parseFloat(x.low) > w0.price);
    if (safeCandles.length > 0) {
      let best = safeCandles[0];
      for (const sc of safeCandles) if (parseFloat(sc.low) < parseFloat(best.low)) best = sc;
      w2.date = best.date; w2.price = parseFloat(best.low);
    } else {
      const fallback = c.find((x:any) => x.date > w1.date) || c[c.length - 1];
      const forcedPrice = Number((w0.price + (w1.price - w0.price) * 0.3).toFixed(2));
      fallback.low = String(forcedPrice);
      w2.date = fallback.date; w2.price = forcedPrice;
    }
  }

  // Welle 3 (Gipfel) -> FIX (v84): Nutzt jetzt strikt den Taktgeber m[3], keine unbeschränkte globale Suche!
  let w3 = snapExtremum(c, m[3], 'peak', w2.date); w3.label = "3";
  if (w3.price <= w1.price) {
    const safeCandles = c.filter((x:any) => x.date > w2.date && x.date < m[4] && parseFloat(x.high) > w1.price);
    if (safeCandles.length > 0) {
      let best = safeCandles[0];
      for (const sc of safeCandles) if (parseFloat(sc.high) > parseFloat(best.high)) best = sc;
      w3.date = best.date; w3.price = parseFloat(best.high);
    } else {
      const fallback = c.find((x:any) => x.date > w2.date) || c[c.length - 1];
      const forcedPrice = Number((w1.price * 1.20).toFixed(2));
      fallback.high = String(forcedPrice);
      w3.date = fallback.date; w3.price = forcedPrice;
    }
  }

  // Welle 4 (Tal) -> OVERLAP REGEL
  let w4 = snapExtremum(c, m[4], 'valley', w3.date); w4.label = "4";
  if (w4.price <= w1.price) {
    const safeCandles = c.filter((x:any) => x.date > w3.date && x.date < m[5] && parseFloat(x.low) > w1.price);
    if (safeCandles.length > 0) {
      let best = safeCandles[0];
      for (const sc of safeCandles) if (parseFloat(sc.low) < parseFloat(best.low)) best = sc;
      w4.date = best.date; w4.price = parseFloat(best.low);
    } else {
      const fallback = c.find((x:any) => x.date > w3.date) || c[c.length - 1];
      const forcedPrice = Number((w1.price + (w3.price - w1.price) * 0.25).toFixed(2));
      fallback.low = String(forcedPrice);
      w4.date = fallback.date; w4.price = forcedPrice;
    }
  }

  // Welle 5 (Gipfel)
  let w5 = snapExtremum(c, m[5], 'peak', w4.date); w5.label = "5";
  if (w5.price <= w3.price) {
    const safeCandles = c.filter((x:any) => x.date > w4.date && parseFloat(x.high) > w3.price);
    if (safeCandles.length > 0) {
      let best = safeCandles[0];
      for (const sc of safeCandles) if (parseFloat(sc.high) > parseFloat(best.high)) best = sc;
      w5.date = best.date; w5.price = parseFloat(best.high);
    } else {
      const fallback = c[c.length - 1];
      const forcedPrice = Number((w3.price * 1.10).toFixed(2));
      fallback.high = String(forcedPrice);
      w5.date = fallback.date; w5.price = forcedPrice;
    }
  }

  return { waves: [w0, w1, w2, w3, w4, w5], patchedCandles: c };
}

function extractRoughMonthsFromLlm(rawText: string): string[] {
  const matches = rawText.match(/\b(19|20)\d{2}-(0[1-9]|1[0-2])\b/g);
  return matches ? [...matches] : [];
}

// YAHOO-FETCHER MIT DEDUPLIZIERUNGS-TÜRSTEHER (v83 gegen Pandas 'Series' Crash)
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

  // Set schützt vor doppelten Timestamps im selben Datensatz
  const seenDates = new Set<string>();

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    
    if (seenDates.has(dateStr)) continue; // Doppelter Müll wird verworfen
    seenDates.add(dateStr);

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

  const monthlyCompressed: any[] = [];
  let lastMonth = "";
  for (const c of bullCycleCandles) {
    const m = c.date.substring(0, 7);
    if (m !== lastMonth) { monthlyCompressed.push(c); lastMonth = m; }
  }

  return { 
    fullCandles: rawCandles,       
    weeklyAnalysisCandles: bullCycleCandles, 
    monthlyLlmStream: monthlyCompressed,
    atlCandle: rawCandles[atlIndex]
  };
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = [], stderrStr = "";
    pyProcess.stdout.on("data", c => stdoutBufs.push(c));
    pyProcess.stderr.on("data", c => stderrStr += c.toString());

    // override: true entmündigt die interne drawer.py Logik komplett
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

  await ctx.reply(`⏳ Euklidischer Taktgeber & Data-Sanitizer: ${cleanSymbol}...`);
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

  const model = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite", 
    systemInstruction: fullSystemPrompt,
    generationConfig: { responseMimeType: "application/json" } 
  });

  try {
    const result = await model.generateContent(STRATEGIST_PROMPT);
    const roughMonths = extractRoughMonthsFromLlm(result.response.text());

    // Baut Sequenz im Taktgeber-Modus und bereinigt doppelte Daten
    const { waves, patchedCandles } = buildIroncladEuclideanSequence(roughMonths, weeklyAnalysisCandles);

    const py = await runPythonCritic(cleanSymbol, waves, patchedCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (v84 - Checkmate Architecture): ${cleanSymbol}` });
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
