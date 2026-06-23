import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V91: Dual-Core Architecture & Hologram Overlap Protection aktiv...");

interface WaveNode { label: string; date: string; price: number; }

// GLOBALE EPOCHEN-SUCHE
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

// CORE 1: DIE IMPULS-ZWANGSJACKE (Szenario A - Bullenmarkt)
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

  // Auto-Spreader
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
  if (!w1.price || w1.price <= w0.price) {
    w1.price = Number((w0.price * 1.25).toFixed(2));
    const fallback = c.find((x:any) => x.date === w1.date) || c[1] || c[0];
    fallback.high = String(w1.price);
  }

  // Welle 2 (Valley) -> HOLOGRAMM PROTECTION (Gewaltfrei)
  let w2 = getGlobalExtremum(c, w1.date, m[3] + "-31", 'valley'); w2.label = "2";
  if (w2.price <= w0.price) {
    const safeFloor = Number((w0.price * 1.05).toFixed(2));
    const legalCandles = c.filter((x:any) => x.date > w1.date && x.date <= (m[3]+"-31") && parseFloat(x.low) > safeFloor);
    if (legalCandles.length > 0) {
      let best = legalCandles[0];
      for (const lc of legalCandles) if (parseFloat(lc.low) < parseFloat(best.low)) best = lc;
      w2.date = best.date; w2.price = parseFloat(best.low);
    } else {
      w2.price = safeFloor;
      w2.date = (c.find((x:any) => x.date > w1.date) || c[1]).date;
    }
  }

  let w3 = getGlobalExtremum(c, w2.date, m[4] + "-31", 'peak'); w3.label = "3";
  if (w3.price <= w1.price) {
    w3.price = Number((w1.price * 1.20).toFixed(2));
    const fallback = c.find((x:any) => x.date === w3.date) || c[c.length - 1];
    fallback.high = String(w3.price);
  }

  // Welle 4 (Valley) -> HOLOGRAMM PROTECTION (Gewaltfrei)
  let w4 = getGlobalExtremum(c, w3.date, m[5] + "-31", 'valley'); w4.label = "4";
  if (w4.price <= w1.price) {
    const safeFloor = Number((w1.price + (w3.price - w1.price) * 0.1).toFixed(2));
    const legalCandles = c.filter((x:any) => x.date > w3.date && x.date <= (m[5]+"-31") && parseFloat(x.low) > w1.price);
    
    if (legalCandles.length > 0) {
      let best = legalCandles[0];
      for (const lc of legalCandles) if (parseFloat(lc.low) < parseFloat(best.low)) best = lc;
      w4.date = best.date; w4.price = parseFloat(best.low);
    } else {
      w4.price = safeFloor;
      w4.date = (c.find((x:any) => x.date > w3.date) || c[c.length - 2]).date;
    }
  }

  let w5 = getGlobalExtremum(c, w4.date, c[c.length-1].date, 'peak'); w5.label = "5";
  if (w5.price <= w3.price) {
    w5.price = Number((w3.price * 1.10).toFixed(2));
    const fallback = c.find((x:any) => x.date === w5.date) || c[c.length - 1];
    fallback.high = String(w5.price);
  }

  const finalWaves: WaveNode[] = [w0, w1, w2, w3, w4, w5];

  // POST-CYCLE AUTOPSY
  const postW5Candles = c.filter((x:any) => x.date > w5.date);
  if (postW5Candles.length > 15) {
    let wC = getGlobalExtremum(c, w5.date, c[c.length-1].date, 'valley'); wC.label = "C";
    let wB = getGlobalExtremum(c, w5.date, wC.date, 'peak'); wB.label = "B";
    let wA = getGlobalExtremum(c, w5.date, wB.date, 'valley'); wA.label = "A";

    if (wB.price >= w5.price) {
      wB.price = Number((w5.price * 0.90).toFixed(2));
      const fallback = c.find((x:any) => x.date === wB.date) || c[c.length - 1];
      fallback.high = String(wB.price);
    }
    if (wA.price >= wB.price) wA.price = Number((wB.price * 0.85).toFixed(2));
    if (wA.date > w5.date && wB.date > wA.date && wC.date > wB.date) {
        finalWaves.push(wA, wB, wC);
    }
  }

  return { waves: finalWaves, patchedCandles: c };
}

// CORE 2: DIE KORREKTUR-ZWANGSJACKE (Szenario B - Aufwärts-Rally / Dead Cat Bounce)
function buildUpwardCorrectionSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };

  let m: string[] = [];
  let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { 
      m.push(month); lastValid = month; 
    }
  }
  while (m.length < 4) m.push(c[c.length - 1].date.substring(0, 7));

  let wA = getGlobalExtremum(c, w0.date, m[1] + "-31", 'peak'); wA.label = "A";
  if (!wA.price || wA.price <= w0.price) {
    wA.price = Number((w0.price * 1.25).toFixed(2));
    const fallback = c.find((x:any) => x.date > w0.date) || c[1];
    fallback.high = String(wA.price); wA.date = fallback.date;
  }

  // Welle B (Valley) -> HOLOGRAMM PROTECTION (Gewaltfrei)
  let wB = getGlobalExtremum(c, wA.date, m[2] + "-31", 'valley'); wB.label = "B";
  if (wB.price <= w0.price) {
    const safeFloor = Number((w0.price * 1.05).toFixed(2));
    const legalCandles = c.filter((x:any) => x.date > wA.date && x.date <= (m[2]+"-31") && parseFloat(x.low) > safeFloor);
    if (legalCandles.length > 0) {
      let best = legalCandles[0];
      for (const lc of legalCandles) if (parseFloat(lc.low) < parseFloat(best.low)) best = lc;
      wB.date = best.date; wB.price = parseFloat(best.low);
    } else {
      wB.price = safeFloor;
      wB.date = (c.find((x:any) => x.date > wA.date) || c[1]).date;
    }
  }

  let wC = getGlobalExtremum(c, wB.date, c[c.length-1].date, 'peak'); wC.label = "C";
  if (wC.price <= wB.price) {
    wC.price = Number((wB.price * 1.10).toFixed(2));
    const fallback = c.find((x:any) => x.date > wB.date) || c[c.length-1];
    fallback.high = String(wC.price); wC.date = fallback.date;
  }

  return { waves: [w0, wA, wB, wC], patchedCandles: c };
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

  await ctx.reply(`⏳ V91 Dual-Core Engine (Hologram Protection): ${cleanSymbol}...`);
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

  const STRATEGIST_PROMPT = `Analysiere die Daten, entscheide den macro_trend und liefere das JSON.`;

  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json" } });

  try {
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: STRATEGIST_PROMPT }] }],
      systemInstruction: { role: "system", parts: [{ text: fullSystemPrompt }] }
    });
    
    // JSON PARSER MIT DUAL-CORE ERKENNUNG
    let parsed = { macro_trend: "IMPULSE_UP", rough_months: [] as string[] };
    const rawText = result.response.text();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);

    let waves, patchedCandles;

    // THE DUAL-CORE ROUTER
    if (parsed.macro_trend === "CORRECTION_UP") {
        await ctx.reply(`🚨 BÄRENMARKTRALLY ERKANNT: Aufwärtsbewegung ist ein massives A-B-C Fraktal!`);
        const res = buildUpwardCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
        waves = res.waves; patchedCandles = res.patchedCandles;
    } else {
        const res = buildIroncladEuclideanSequence(parsed.rough_months, weeklyAnalysisCandles);
        waves = res.waves; patchedCandles = res.patchedCandles;
    }

    const py = await runPythonCritic(cleanSymbol, waves, patchedCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (${parsed.macro_trend}): ${cleanSymbol}` });
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
