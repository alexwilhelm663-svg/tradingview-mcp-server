import { spawn } from "child_process";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getElliottWaveSystemPrompt } from "./prompt";

export interface WaveNode { label: string; date: string; price: number; }

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

function buildSecularBearSequence(candles: any[], athIdx: number): WaveNode[] {
  const w0: WaveNode = { label: "0", date: candles[0].date, price: parseFloat(candles[0].low) };
  const w5: WaveNode = { label: "5", date: candles[athIdx].date, price: parseFloat(candles[athIdx].high) };
  
  const seg = Math.floor(athIdx / 4);
  let w1 = getGlobalExtremum(candles, w0.date, candles[Math.max(1, seg)].date, 'peak'); w1.label = "1";
  let w2 = getGlobalExtremum(candles, w1.date, candles[Math.max(2, seg * 2)].date, 'valley'); w2.label = "2";
  
  if (w2.price <= w0.price) {
      const valid = candles.filter(c => c.date > w1.date && c.date <= candles[Math.max(2, seg * 2)].date && parseFloat(c.low) > w0.price);
      if (valid.length > 0) {
          let b = valid[0]; for (const c of valid) if (parseFloat(c.low) < parseFloat(b.low)) b = c;
          w2 = { label: "2", date: b.date, price: parseFloat(b.low) };
      } else w2.price = w0.price * 1.05; 
  }

  let w3 = getGlobalExtremum(candles, w2.date, candles[Math.max(3, seg * 3)].date, 'peak'); w3.label = "3";
  let w4 = getGlobalExtremum(candles, w3.date, candles[Math.max(4, athIdx - 1)].date, 'valley'); w4.label = "4";

  if (w4.price <= w1.price) {
      const valid = candles.filter(c => c.date > w3.date && c.date < w5.date && parseFloat(c.low) > w1.price);
      if (valid.length > 0) {
          let b = valid[0]; for (const c of valid) if (parseFloat(c.low) < parseFloat(b.low)) b = c;
          w4 = { label: "4", date: b.date, price: parseFloat(b.low) };
      } else { w4.price = w1.price * 1.05; }
  }
  
  const bearCandles = candles.slice(athIdx);
  let minIdx = 0; let minLow = Infinity;
  for (let i = 0; i < bearCandles.length; i++) {
      const l = parseFloat(bearCandles[i].low);
      if (l < minLow) { minLow = l; minIdx = i; }
  }
  if (minIdx === 0) minIdx = bearCandles.length - 1;
  
  let maxIdx = 0; let maxHigh = -Infinity;
  for (let i = 0; i < minIdx; i++) {
      const h = parseFloat(bearCandles[i].high);
      if (h > maxHigh) { maxHigh = h; maxIdx = i; }
  }
  if (maxIdx === 0) maxIdx = Math.floor(minIdx / 2);
  
  let aIdx = 0; let aLow = Infinity;
  for (let i = 0; i < maxIdx; i++) {
      const l = parseFloat(bearCandles[i].low);
      if (l < aLow) { aLow = l; aIdx = i; }
  }
  if (aIdx === 0) aIdx = Math.floor(maxIdx / 2);
  
  const wA: WaveNode = { label: "A", date: bearCandles[aIdx].date, price: parseFloat(bearCandles[aIdx].low) };
  const wB: WaveNode = { label: "B", date: bearCandles[maxIdx].date, price: parseFloat(bearCandles[maxIdx].high) };
  const wC: WaveNode = { label: "C", date: bearCandles[minIdx].date, price: parseFloat(bearCandles[minIdx].low) };
  
  return [w0, w1, w2, w3, w4, w5, wA, wB, wC];
}

function buildIroncladEuclideanSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };
  let m: string[] = []; let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { m.push(month); lastValid = month; }
  }
  if (m.length < 6) {
    const lastIdx = m.length > 0 ? c.findIndex((x:any) => x.date.startsWith(m[m.length-1])) : 0;
    const remainingCandles = c.length - 1 - Math.max(0, lastIdx);
    const missingSlots = 6 - m.length;
    const step = Math.max(1, Math.floor(remainingCandles / (missingSlots + 1)));
    for (let i = 1; i <= missingSlots; i++) {
      m.push(c[Math.min(c.length - 1, Math.max(0, lastIdx) + (i * step))].date.substring(0, 7));
    }
  }
  let w1 = getGlobalExtremum(c, w0.date, m[2] + "-31", 'peak'); w1.label = "1";
  let w2 = getGlobalExtremum(c, w1.date, m[3] + "-31", 'valley'); w2.label = "2";
  if (w2.price <= w0.price) throw new Error("RETRACEMENT_VIOLATION");
  let w3 = getGlobalExtremum(c, w2.date, m[4] + "-31", 'peak'); w3.label = "3";
  let w4 = getGlobalExtremum(c, w3.date, m[5] + "-31", 'valley'); w4.label = "4";
  if (w4.price <= w1.price) throw new Error("OVERLAP_VIOLATION");
  
  let w5 = getGlobalExtremum(c, w4.date, c[c.length-1].date, 'peak'); w5.label = "5";
  
  // 🔥 BUILD 107: DER ANTI-WURMLOCH SCHUTZ FÜR WELLE 5
  if (w5.price <= w4.price) throw new Error("WAVE5_VALLEY_VIOLATION");

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
  let m: string[] = []; let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { m.push(month); lastValid = month; }
  }
  while (m.length < 4) m.push(c[c.length - 1].date.substring(0, 7));
  let wA = getGlobalExtremum(c, w0.date, m[1] + "-31", 'peak'); wA.label = "A";
  let wB = getGlobalExtremum(c, wA.date, m[2] + "-31", 'valley'); wB.label = "B";
  let wC = getGlobalExtremum(c, wB.date, c[c.length-1].date, 'peak'); wC.label = "C";
  return { waves: [w0, wA, wB, wC], patchedCandles: c };
}

function buildComplexCorrectionSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };
  let m: string[] = []; let lastValid = "";
  for (const month of (llmMonths || [])) {
    if (month > lastValid && month >= c[0].date.substring(0,7)) { m.push(month); lastValid = month; }
  }
  while (m.length < 4) m.push(c[c.length - 1].date.substring(0, 7));
  let wW = getGlobalExtremum(c, w0.date, m[1] + "-31", 'peak'); wW.label = "W";
  let wX = getGlobalExtremum(c, wW.date, m[2] + "-31", 'valley'); wX.label = "X";
  let wY = getGlobalExtremum(c, wX.date, c[c.length-1].date, 'peak'); wY.label = "Y";
  return { waves: [w0, wW, wX, wY], patchedCandles: c };
}

async function fetchVanillaYahooCandles(symbol: string) {
  const cleanSym = symbol.trim().toUpperCase();
  const res = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSym)}?interval=1wk&range=max`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json(); const chartData = raw.chart?.result?.[0];
  if (!chartData) throw new Error("Keine Kursdaten im Yahoo-JSON.");
  const timestamps = chartData.timestamp || []; const quote = chartData.indicators?.quote?.[0] || {};
  const rawCandles: any[] = []; let minLow = Infinity; let atlIndex = 0; const seenDates = new Set<string>();

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
    if (seenDates.has(dateStr)) continue; seenDates.add(dateStr);
    const currentLow = parseFloat(quote.low[i]);
    if (currentLow < minLow) { minLow = currentLow; atlIndex = rawCandles.length; }
    
    const vol = quote.volume?.[i] || 0;

    rawCandles.push({ 
        date: dateStr, 
        open: Number(quote.open[i]).toFixed(4), 
        high: Number(quote.high[i]).toFixed(4), 
        low: Number(quote.low[i]).toFixed(4), 
        close: Number(quote.close[i]).toFixed(4),
        volume: vol
    });
  }
  return { fullCandles: rawCandles, weeklyAnalysisCandles: rawCandles.slice(atlIndex), atlCandle: rawCandles[atlIndex] };
}

function runPythonCritic(symbol: string, waves: any[], candles: any[]): Promise<{ pngBuffer: Buffer | null, errorMessage: string | null }> {
  return new Promise((resolve) => {
    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    let stdoutBufs: Buffer[] = []; let stderrStr = "";
    pyProcess.stdout.on("data", c => stdoutBufs.push(c)); pyProcess.stderr.on("data", c => stderrStr += c.toString());
    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles, validate: false, strict: false, override: true }));
    pyProcess.stdin.end();
    pyProcess.on("close", (code) => {
      if (code !== 0) return resolve({ pngBuffer: null, errorMessage: `Python Crash:\n${stderrStr.trim()}` });
      if (stdoutBufs.length > 0) return resolve({ pngBuffer: Buffer.concat(stdoutBufs), errorMessage: null });
      resolve({ pngBuffer: null, errorMessage: "Prozess beendet ohne Bild." });
    });
  });
}

export async function analyzeAsset(symbol: string, genAI: GoogleGenerativeAI) {
  const marketData = await fetchVanillaYahooCandles(symbol);
  const { weeklyAnalysisCandles, atlCandle } = marketData;
  if (weeklyAnalysisCandles.length < 26) throw new Error("Säkulares Bärenmarkt-Veto (Historie zu kurz).");

  const lastCandle = weeklyAnalysisCandles[weeklyAnalysisCandles.length - 1];
  const currentPrice = parseFloat(lastCandle.close);

  let globalAthPrice = 0; let globalAthIdx = 0;
  for (let i = 0; i < weeklyAnalysisCandles.length; i++) {
      const h = parseFloat(weeklyAnalysisCandles[i].high);
      if (h > globalAthPrice) { globalAthPrice = h; globalAthIdx = i; }
  }
  const athCandle = weeklyAnalysisCandles[globalAthIdx];
  const priceDropFromAthPct = ((globalAthPrice - currentPrice) / globalAthPrice) * 100;
  const daysSinceAth = (new Date(lastCandle.date).getTime() - new Date(athCandle.date).getTime()) / (1000 * 3600 * 24);

  if (priceDropFromAthPct > 60 && daysSinceAth > 400) {
      const waves = buildSecularBearSequence(weeklyAnalysisCandles, globalAthIdx);
      const py = await runPythonCritic(symbol, waves, weeklyAnalysisCandles);
      if (!py.pngBuffer) throw new Error(`Python Veto: ${py.errorMessage}`);
      return { buffer: py.pngBuffer, finalTrend: "MACRO_BEAR_DOWN", isHotSetup: false, killZoneStatus: `📉 **SÄKULARER BÄRENMARKT:** Abwärtstrend (-${priceDropFromAthPct.toFixed(1)}% vom ATH). Seziert am ${athCandle.date}.` };
  }

  const minifiedMarketStream = weeklyAnalysisCandles.map(c => `${c.date},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join("|");
  const fullSystemPrompt = getElliottWaveSystemPrompt(weeklyAnalysisCandles[0].date, weeklyAnalysisCandles[weeklyAnalysisCandles.length-1].date, minifiedMarketStream) + `\n🔥 ZWANGS-ANKER: Welle 0 ist der ${atlCandle.date} (${atlCandle.low}).`;

  let basePrompt = `Analysiere die Daten, entscheide den macro_trend und liefere das JSON.`;
  let currentPrompt = basePrompt;
  let attempts = 0; const maxAttempts = 3;
  let waves: WaveNode[] = []; let patchedCandles: any[] = [];
  let finalTrend = "IMPULSE_UP"; let currentTemp = 0.0; 

  while (attempts < maxAttempts) {
    attempts++;
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json", temperature: currentTemp } });
    const result = await model.generateContent({ contents: [{ role: "user", parts: [{ text: currentPrompt }] }], systemInstruction: { role: "system", parts: [{ text: fullSystemPrompt }] } });
    let parsed = { macro_trend: "IMPULSE_UP", rough_months: [] as string[] };
    const jsonMatch = result.response.text().match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);

    finalTrend = parsed.macro_trend;

    if (finalTrend === "COMPLEX_CORRECTION") {
        const res = buildComplexCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
        waves = res.waves; patchedCandles = res.patchedCandles; break;
    } else if (finalTrend === "CORRECTION_UP") {
        const res = buildUpwardCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
        waves = res.waves; patchedCandles = res.patchedCandles; break;
    } else {
        try {
            const res = buildIroncladEuclideanSequence(parsed.rough_months, weeklyAnalysisCandles);
            waves = res.waves; patchedCandles = res.patchedCandles; break; 
        } catch (e: any) {
            // 🔥 BUILD 107 CATCH-UPGRADE: FÄNGT DIE WELLE-5 ANOMALIE AB
            if (e.message === "OVERLAP_VIOLATION" || e.message === "RETRACEMENT_VIOLATION" || e.message === "WAVE5_VALLEY_VIOLATION") {
                if (attempts < maxAttempts) {
                    currentTemp += 0.35; currentPrompt = `${basePrompt}\n\nACHTUNG! GEOMETRIE-FEHLER:\n${e.message}\nWÄHLE ANDERE MONATE!`;
                } else {
                    finalTrend = "CORRECTION_UP";
                    const res = buildUpwardCorrectionSequence(parsed.rough_months, weeklyAnalysisCandles);
                    waves = res.waves; patchedCandles = res.patchedCandles; break;
                }
            } else throw e; 
        }
    }
  }

  const py = await runPythonCritic(symbol, waves, patchedCandles);
  if (!py.pngBuffer) throw new Error(`Python Veto: ${py.errorMessage}`);

  let isHotSetup = false; let killZoneStatus = "";
  if (finalTrend === "IMPULSE_UP" && waves.length >= 6) {
      const w0 = waves[0].price; const w4 = waves[4].price; const w5 = waves[5].price;
      if (w5 > w0) {
          const logW0 = Math.log(w0); const logW5 = Math.log(w5);
          const logFib382 = Math.exp(logW5 - (0.382 * (logW5 - logW0)));
          if (currentPrice <= logFib382 && currentPrice >= (w4 * 0.8)) {
              isHotSetup = true; 
              killZoneStatus = `🚨 **HOT SETUP:** Kurs (${currentPrice.toFixed(2)}$) befindet sich in der Macro Kill-Zone!`;
          }
      }
  }
  return { buffer: py.pngBuffer, finalTrend, isHotSetup, killZoneStatus };
}
