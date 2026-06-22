import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V78: The General & The Sniper (Decoupled Euclidean Architecture) aktiv...");

interface SnappedWave { label: string; date: string; price: number; }

// SNIPER-FUNKTION: Sucht im hochpräzisen Wochenchart das absolute Extremum um den groben Monats-Tipp der KI
function snapToMarketExtremum(weeklyCandles: any[], roughMonthStr: string, mode: 'peak' | 'valley'): SnappedWave {
  const cleanMonth = String(roughMonthStr || "").substring(0, 7);
  let pivotCandle = weeklyCandles.find(c => c.date.startsWith(cleanMonth)) || weeklyCandles[weeklyCandles.length - 1];
  
  const pivotIdx = weeklyCandles.indexOf(pivotCandle);
  const startIdx = Math.max(0, pivotIdx - 5); // +/- 5 Wochen Suchfenster
  const endIdx = Math.min(weeklyCandles.length - 1, pivotIdx + 5);
  
  const window = weeklyCandles.slice(startIdx, endIdx + 1);

  if (mode === 'peak') {
    let maxC = window[0];
    for (const c of window) if (parseFloat(c.high) > parseFloat(maxC.high)) maxC = c;
    return { label: "", date: maxC.date, price: parseFloat(maxC.high) };
  } else {
    let minC = window[0];
    for (const c of window) if (parseFloat(c.low) < parseFloat(minC.low)) minC = c;
    return { label: "", date: minC.date, price: parseFloat(minC.low) };
  }
}

// DER EUKLIDISCHE SANITÄTER: Garantiert die Einhaltung aller Elliott-Gesetze per Code
function sanitizeAndEnforceGeometry(roughLlmDates: string[], weeklyCandles: any[], atlCandle: any): SnappedWave[] {
  // 0. Auffüllen, falls die KI faul war
  const dates = [...roughLlmDates];
  while (dates.length < 6) dates.push(dates[dates.length - 1] || weeklyCandles[weeklyCandles.length-1].date);

  // 1. Hard-Lock von Welle 0 auf das historische Allzeittief des Bullenzyklus!
  const w0: SnappedWave = { label: "0", date: atlCandle.date, price: parseFloat(atlCandle.low) };
  
  // 2. Präzisions-Snapping der restlichen Wellen
  const w1 = snapToMarketExtremum(weeklyCandles, dates[1], 'peak'); w1.label = "1";
  const w2 = snapToMarketExtremum(weeklyCandles, dates[2], 'valley'); w2.label = "2";
  const w3 = snapToMarketExtremum(weeklyCandles, dates[3], 'peak'); w3.label = "3";
  const w4 = snapToMarketExtremum(weeklyCandles, dates[4], 'valley'); w4.label = "4";
  const w5 = snapToMarketExtremum(weeklyCandles, dates[5], 'peak'); w5.label = "5";

  const seq = [w0, w1, w2, w3, w4, w5];

  // 3. CHRONOLOGIE-ZWANG (Welle N muss zeitlich strikt nach Welle N-1 liegen)
  for (let i = 1; i < seq.length; i++) {
    if (seq[i].date <= seq[i-1].date) {
      const prevIdx = weeklyCandles.findIndex(c => c.date === seq[i-1].date);
      const forcedNext = weeklyCandles[Math.min(weeklyCandles.length - 1, prevIdx + 4)]; // 4 Wochen nach rechts schieben
      seq[i].date = forcedNext.date;
      seq[i].price = i % 2 === 1 ? parseFloat(forcedNext.high) : parseFloat(forcedNext.low);
    }
  }

  // 4. RETRACEMENT-RETTUNG (Welle 2 MUSS strikt über Welle 0 liegen)
  if (w2.price <= w0.price) {
    const validCandles = weeklyCandles.filter(c => c.date > w1.date && c.date < w3.date && parseFloat(c.low) > w0.price);
    if (validCandles.length > 0) {
      validCandles.sort((a, b) => parseFloat(a.low) - parseFloat(b.low));
      w2.date = validCandles[0].date; w2.price = parseFloat(validCandles[0].low);
    } else w2.price = Number(((w0.price + w1.price) / 2).toFixed(2));
  }

  // 5. DIE HEILIGE OVERLAP-RETTUNG (Welle 4 MUSS strikt über Gipfel 1 liegen)
  if (w4.price <= w1.price) {
    const validCandles = weeklyCandles.filter(c => c.date > w3.date && c.date < w5.date && parseFloat(c.low) > w1.price);
    if (validCandles.length > 0) {
      validCandles.sort((a, b) => parseFloat(a.low) - parseFloat(b.low));
      w4.date = validCandles[0].date; w4.price = parseFloat(validCandles[0].low);
    } else w4.price = Number(((w1.price + w3.price) / 2).toFixed(2));
  }

  return seq;
}

// Extrahiert Monats-Strings aus dem LLM-Output, egal wie es formatiert wurde
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

  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    const dateStr = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
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

  // KOMPRESSION FÜR DIE KI: Wir erzeugen einen extrem leichten Monats-Stream!
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
    pyProcess.stdin.write(JSON.stringify({ symbol, waves, candles }));
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

  await ctx.reply(`⏳ Makro-Analyse & Euklidischer Sniper: ${cleanSymbol}...`);
  let marketData;
  try { marketData = await fetchVanillaYahooCandles(cleanSymbol); } 
  catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const { fullCandles, weeklyAnalysisCandles, monthlyLlmStream, atlCandle } = marketData;

  if (weeklyAnalysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlCandle.low} USD) erst am ${atlCandle.date}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

  // Ein extrem schlanker, leicht verdaulicher Prompt für die KI
  const miniStreamText = monthlyLlmStream.map(c => `${c.date.substring(0,7)},H:${c.high},L:${c.low}`).join("|");
  const STRATEGIST_PROMPT = `
Du bist Chef-Stratege für Elliott-Wellen.
Hier ist der auf Monatsbasis komprimierte Kursverlauf seit dem historischen Boden (${atlCandle.date}):
${miniStreamText}

Nenne mir AUSSCHLIESSLICH die 6 Monats-Daten (Format: YYYY-MM) für die Hauptwellen 0 bis 5.
Antworte exakt als JSON:
{
  "rough_months": ["YYYY-MM", "YYYY-MM", "YYYY-MM", "YYYY-MM", "YYYY-MM", "YYYY-MM"]
}`;

  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json" } });

  try {
    const result = await model.generateContent(STRATEGIST_PROMPT);
    const roughMonths = extractRoughMonthsFromLlm(result.response.text());

    if (roughMonths.length < 2) {
      return ctx.reply(`❌ Makro-KI verweigerte die Zählung. Output: ${result.response.text()}`);
    }

    // EUKLIDISCHE VOLLSTRECKUNG (Snapping & Sanitäter)
    const flawlessWaves = sanitizeAndEnforceGeometry(roughMonths, weeklyAnalysisCandles, atlCandle);

    // Python kriegt die perfekten Koordinaten und den ungekürzten Chart
    const py = await runPythonCritic(cleanSymbol, flawlessWaves, fullCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (Decoupled Euclidean View): ${cleanSymbol}` });
    } else {
      await ctx.reply(`❌ Python Veto nach Bereinigung: ${py.errorMessage}`);
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
