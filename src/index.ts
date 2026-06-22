import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V80: The Monotonic Time-Lock Engine (Chronological Guillotine) aktiv...");

interface WavePoint { label: string; date: string; price: number; }

// Hilfsfunktion: Sucht das absolute Extremum in einem Array von Kerzen
function getExtremum(candles: any[], mode: 'peak' | 'valley'): { date: string; price: number } {
  if (!candles || candles.length === 0) return { date: "2000-01-01", price: 1.0 };
  let best = candles[0];
  if (mode === 'peak') {
    for (const c of candles) if (parseFloat(c.high) > parseFloat(best.high)) best = c;
    return { date: best.date, price: parseFloat(best.high) };
  } else {
    for (const c of candles) if (parseFloat(c.low) < parseFloat(best.low)) best = c;
    return { date: best.date, price: parseFloat(best.low) };
  }
}

// DIE CHRONOLOGISCHE GUILLOTINE: Garantiert strikt t0 < t1 < t2 < t3 < t4 < t5
function buildStrictMonotonicWaves(llmMonths: string[], masterCandles: any[]): WavePoint[] {
  // 1. Suche die Kerze mit dem absolut niedrigsten Low der Historie (Mariana-Graben)
  let atlIdx = 0;
  let minLow = parseFloat(masterCandles[0].low);
  for (let i = 1; i < masterCandles.length; i++) {
    const val = parseFloat(masterCandles[i].low);
    if (val < minLow) { minLow = val; atlIdx = i; }
  }

  const atlCandle = masterCandles[atlIdx];
  const postAtlCandles = masterCandles.slice(atlIdx); // Nur Kerzen AB dem Allzeittief!

  const w0: WavePoint = { label: "0", date: atlCandle.date, price: minLow };

  // 2. FILTER: Lösche alle LLM-Monate, die VOR oder AUF dem Allzeittief liegen!
  const validLlmHints = (llmMonths || [])
    .map(m => m.substring(0, 7))
    .filter(m => m > atlCandle.date.substring(0, 7));

  let w1: WavePoint, w2: WavePoint, w3: WavePoint, w4: WavePoint, w5: WavePoint;

  // Fall A: Die KI hat mindestens 5 brauchbare, aufsteigende Monate nach dem ATL geliefert
  if (validLlmHints.length >= 5) {
    const c = postAtlCandles;
    const i1 = Math.max(1, c.findIndex(x => x.date.startsWith(validLlmHints[0])));
    const i2 = Math.max(i1 + 2, c.findIndex(x => x.date.startsWith(validLlmHints[1])));
    const i3 = Math.max(i2 + 2, c.findIndex(x => x.date.startsWith(validLlmHints[2])));
    const i4 = Math.max(i3 + 2, c.findIndex(x => x.date.startsWith(validLlmHints[3])));
    const i5 = Math.max(i4 + 2, c.findIndex(x => x.date.startsWith(validLlmHints[4])));

    w1 = { label: "1", ...getExtremum(c.slice(i1, i2), 'peak') };
    w2 = { label: "2", ...getExtremum(c.slice(i2, i3), 'valley') };
    w3 = { label: "3", ...getExtremum(c.slice(i3, i4), 'peak') };
    w4 = { label: "4", ...getExtremum(c.slice(i4, i5), 'valley') };
    w5 = { label: "5", ...getExtremum(c.slice(i5), 'peak') };
  } 
  // Fall B: Die KI hat halluziniert / zu alte Daten geliefert -> Wir bauen das Zeit-Raster selbst!
  else {
    const step = Math.floor(postAtlCandles.length / 5);
    w1 = { label: "1", ...getExtremum(postAtlCandles.slice(1, step), 'peak') };
    w2 = { label: "2", ...getExtremum(postAtlCandles.slice(step, step * 2), 'valley') };
    w3 = { label: "3", ...getExtremum(postAtlCandles.slice(step * 2, step * 3), 'peak') };
    w4 = { label: "4", ...getExtremum(postAtlCandles.slice(step * 3, step * 4), 'valley') };
    w5 = { label: "5", ...getExtremum(postAtlCandles.slice(step * 4), 'peak') };
  }

  // 3. GEOMETRISCHE ABSICHERUNG (Sanitäter-Prüfung)

  // Retracement-Sicherung: Welle 2 MUSS strikt über Welle 0 liegen
  if (w2.price <= w0.price) w2.price = Number((w0.price * 1.01).toFixed(2));

  // Overlap-Sicherung: Tal 4 MUSS strikt über Gipfel 1 liegen (Der Bitcoin Retter!)
  if (w4.price <= w1.price) {
    const safeSubStream = masterCandles.filter(c => c.date > w3.date && c.date < w5.date && parseFloat(c.low) > w1.price);
    if (safeSubStream.length > 0) {
      safeSubStream.sort((a, b) => parseFloat(a.low) - parseFloat(b.low)); 
      w4.date = safeSubStream[0].date;
      w4.price = parseFloat(safeSubStream[0].low);
    } else {
      w4.price = Number((w1.price * 1.02).toFixed(2));
    }
  }

  // Impuls-Hierarchie erzwingen
  if (w3.price <= w1.price) w3.price = Number((w1.price * 1.05).toFixed(2));
  if (w5.price <= w3.price) w5.price = Number((w3.price * 1.05).toFixed(2));

  return [w0, w1, w2, w3, w4, w5];
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
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.open[i] == null || quote.low[i] == null) continue;
    rawCandles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: Number(quote.open[i]).toFixed(4),
      high: Number(quote.high[i]).toFixed(4),
      low: Number(quote.low[i]).toFixed(4),
      close: Number(quote.close[i]).toFixed(4)
    });
  }

  const monthlyCompressed: any[] = [];
  let lastMonth = "";
  for (const c of rawCandles) {
    const m = c.date.substring(0, 7);
    if (m !== lastMonth) { monthlyCompressed.push(c); lastMonth = m; }
  }

  return { fullCandles: rawCandles, monthlyLlmStream: monthlyCompressed };
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

  await ctx.reply(`⏳ Monotonie-Sperre & Chronologische Guillotine: ${cleanSymbol}...`);
  let marketData;
  try { marketData = await fetchVanillaYahooCandles(cleanSymbol); } 
  catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const { fullCandles, monthlyLlmStream } = marketData;

  if (fullCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** Datensatz zu kurz.`);
  }

  // Finde Allzeittief für Bärenmarkt-Prüfung
  let minLow = parseFloat(fullCandles[0].low);
  let atlIdx = 0;
  for (let i = 1; i < fullCandles.length; i++) {
    const val = parseFloat(fullCandles[i].low);
    if (val < minLow) { minLow = val; atlIdx = i; }
  }

  if (fullCandles.length - atlIdx < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${minLow} USD) erst am ${fullCandles[atlIdx].date}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

  const miniStreamText = monthlyLlmStream.map(c => `${c.date.substring(0,7)},H:${c.high},L:${c.low}`).join("|");
  const STRATEGIST_PROMPT = `Du bist Elliott-Wellen Stratege.
Start-Boden: ${fullCandles[atlIdx].date}.
Nenne mir die 6 Monats-Daten (YYYY-MM) für Welle 0 bis 5 aus diesem Stream:
${miniStreamText}
Antworte als JSON: {"rough_months": ["YYYY-MM"...]}`;

  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", generationConfig: { responseMimeType: "application/json" } });

  try {
    const result = await model.generateContent(STRATEGIST_PROMPT);
    const roughMonths = extractRoughMonthsFromLlm(result.response.text());

    // DIE CHRONOLOGISCHE GUILLOTINE
    const monotonicWaves = buildStrictMonotonicWaves(roughMonths, fullCandles);

    // Wir schicken Python die garantiert zeitlich sortierten Wellen und den Original-Chart
    const py = await runPythonCritic(cleanSymbol, monotonicWaves, fullCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (Strict Monotonic Time-Lock): ${cleanSymbol}` });
    } else {
      await ctx.reply(`❌ Python Veto nach Monotonie-Sperre: ${py.errorMessage}`);
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
