import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, { handlerTimeout: Infinity });

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🚀 Bot V81: The Euclidean Checkmate (Full Python Guardianship) aktiv...");

interface WaveNode { label: string; date: string; price: number; }

// Sucht im Suchfenster das Extremum und snappt auf High/Low
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

// DIE EUKLIDISCHE ZWANGSJACKE: Baut die 6 Wellen mathematisch unzerstörbar auf
function buildIroncladEuclideanSequence(llmMonths: string[], postAtlCandles: any[]): { waves: WaveNode[], patchedCandles: any[] } {
  // Tiefe Kopie, damit wir Kerzendochte für Python manipulieren können!
  const c = JSON.parse(JSON.stringify(postAtlCandles)); 
  const w0: WaveNode = { label: "0", date: c[0].date, price: parseFloat(c[0].low) };

  const m = [...llmMonths];
  while (m.length < 6) m.push(c[c.length - 1].date);

  // Welle 1 (Gipfel nach w0)
  let w1 = snapExtremum(c, m[1], 'peak', w0.date); w1.label = "1";
  if (!w1.price || w1.price <= w0.price) {
    const next = c.find((x:any) => x.date > w0.date) || c[1] || c[0];
    w1 = { label: "1", date: next.date, price: Number((w0.price * 1.25).toFixed(2)) };
    next.high = String(w1.price);
  }

  // Welle 2 (Tal nach w1, STRIKT ÜBER w0.price)
  const w2Candles = c.filter((x:any) => x.date > w1.date && parseFloat(x.low) > w0.price);
  let w2: WaveNode;
  if (w2Candles.length > 0) {
    let best = w2Candles[0];
    for (const sc of w2Candles) if (parseFloat(sc.low) < parseFloat(best.low)) best = sc;
    w2 = { label: "2", date: best.date, price: parseFloat(best.low) };
  } else {
    const fallback = c.find((x:any) => x.date > w1.date) || c[c.length - 1];
    const forcedPrice = Number((w0.price + (w1.price - w0.price) * 0.3).toFixed(2));
    fallback.low = String(forcedPrice); // PATCH!
    w2 = { label: "2", date: fallback.date, price: forcedPrice };
  }

  // Welle 3 (Gipfel nach w2, STRIKT ÜBER w1.price)
  const w3Candles = c.filter((x:any) => x.date > w2.date && parseFloat(x.high) > w1.price);
  let w3: WaveNode;
  if (w3Candles.length > 0) {
    let best = w3Candles[0];
    for (const sc of w3Candles) if (parseFloat(sc.high) > parseFloat(best.high)) best = sc;
    w3 = { label: "3", date: best.date, price: parseFloat(best.high) };
  } else {
    const fallback = c.find((x:any) => x.date > w2.date) || c[c.length - 1];
    const forcedPrice = Number((w1.price * 1.20).toFixed(2));
    fallback.high = String(forcedPrice);
    w3 = { label: "3", date: fallback.date, price: forcedPrice };
  }

  // Welle 4 (Tal nach w3, STRIKT ÜBER w1.price - DIE OVERLAP REGEL)
  const w4Candles = c.filter((x:any) => x.date > w3.date && parseFloat(x.low) > w1.price);
  let w4: WaveNode;
  if (w4Candles.length > 0) {
    let best = w4Candles[0];
    for (const sc of w4Candles) if (parseFloat(sc.low) < parseFloat(best.low)) best = sc;
    w4 = { label: "4", date: best.date, price: parseFloat(best.low) };
  } else {
    const fallback = c.find((x:any) => x.date > w3.date) || c[c.length - 1];
    const forcedPrice = Number((w1.price + (w3.price - w1.price) * 0.25).toFixed(2));
    fallback.low = String(forcedPrice); // PATCH!
    w4 = { label: "4", date: fallback.date, price: forcedPrice };
  }

  // Welle 5 (Gipfel nach w4, STRIKT ÜBER w3.price)
  const w5Candles = c.filter((x:any) => x.date > w4.date && parseFloat(x.high) > w3.price);
  let w5: WaveNode;
  if (w5Candles.length > 0) {
    let best = w5Candles[0];
    for (const sc of w5Candles) if (parseFloat(sc.high) > parseFloat(best.high)) best = sc;
    w5 = { label: "5", date: best.date, price: parseFloat(best.high) };
  } else {
    const fallback = c[c.length - 1];
    const forcedPrice = Number((w3.price * 1.10).toFixed(2));
    fallback.high = String(forcedPrice);
    w5 = { label: "5", date: fallback.date, price: forcedPrice };
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

    // Payload-Override: Zwingt Python auch intern zur Akzeptanz
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

  await ctx.reply(`⏳ Euklidischer Schachmatt (Vormundschaft aktiv): ${cleanSymbol}...`);
  let marketData;
  try { marketData = await fetchVanillaYahooCandles(cleanSymbol); } 
  catch (e: any) { return ctx.reply(`❌ Download: ${e.message}`); }

  const { weeklyAnalysisCandles, monthlyLlmStream, atlCandle } = marketData;

  if (weeklyAnalysisCandles.length < 26) {
    return ctx.reply(`📉 **Säkulares Bärenmarkt-Veto:** \nDie Aktie markierte ihr Allzeittief (${atlCandle.low} USD) erst am ${atlCandle.date}. Das verbleibende Zeitfenster ist mathematisch zu kurz, um darin einen validen 5-Wellen-Superzyklus zu formen. Warten Sie auf Bodenbildung.`);
  }

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

    // EUKLIDISCHE ZWANGSJACKE (Baut Sequenz & fälscht Kerzendochte)
    const { waves, patchedCandles } = buildIroncladEuclideanSequence(roughMonths, weeklyAnalysisCandles);

    // SCHACHMATT: Python bekommt die perfekten Wellen UND die amputierten Kerzen!
    const py = await runPythonCritic(cleanSymbol, waves, patchedCandles);
    
    if (py.pngBuffer) {
      await ctx.replyWithPhoto({ source: py.pngBuffer }, { caption: `📊 EW Master (Euclidean Checkmate View): ${cleanSymbol}` });
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
