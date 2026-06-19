import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

// --- 1. BULLETPROOF SERVER START (Verhindert Render SIGTERM) ---
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot alive");
});
server.listen(PORT, () => console.log(`🚀 Server auf Port ${PORT} gestartet.`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

process.on('uncaughtException', (err) => console.error('FATAL:', err));
process.on('unhandledRejection', (err) => console.error('PROMISE FAIL:', err));

// --- 2. HILFSFUNKTIONEN ---

// Holt die Daten von Yahoo Finance und sortiert ungültige Kerzen aus
async function fetchYahooData(symbol: string, timeframe: string) {
    const interval = timeframe.toLowerCase().includes('w') ? '1wk' : '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=5y`;
    
    const res = await fetch(url);
    const data = await res.json();
    if (!data.chart.result) throw new Error(`Yahoo fand den Ticker ${symbol} nicht.`);
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];
    
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (quote.open[i] !== null && quote.close[i] !== null) {
            candles.push({
                d: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                o: quote.open[i],
                h: quote.high[i],
                l: quote.low[i],
                c: quote.close[i]
            });
        }
    }
    return candles;
}

// Extrahiert die Wellen aus der KI-Antwort (Tabelle)
function parseWavesFromTable(text: string) {
    const waves = [];
    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
            const label = parts[0].replace(/[\*\`\[\]]/g, ''); // Markdown entfernen
            let dateStr = parts[1].replace(/[\*\`\[\]]/g, '');
            const price = parseFloat(parts[2].replace(/[^0-9.,-]/g, '').replace(',', '.'));
            
            if (label.length > 0 && label.length <= 4 && !isNaN(price) && dateStr.match(/\d{4}/)) {
                // Fallback für grobe Datumsangaben (z.B. "Mitte 2024")
                if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    const yearMatch = dateStr.match(/\d{4}/);
                    if (yearMatch) dateStr = `${yearMatch[0]}-06-15`; 
                }
                waves.push({ label, date: dateStr, price });
            }
        }
    }
    return waves;
}

// --- 3. KI ANALYSE (Groq Llama 4 Scout) ---
async function getElliottAnalysis(base64Image: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { 
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
        "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        { 
          role: "system", 
          content: "Du bist Analyst. Du MUSST Charts analysieren. Es ist ZWINGEND ERLAUBT Daten und Preise anhand des X/Y-Rasters bestmöglich zu schätzen. Verweigere nie die Antwort." 
        },
        { 
          role: "user", 
          content: [
            { type: "text", text: "1. Lies Ticker & Timeframe ab (Format: 'Ticker: AAPL, Timeframe: 1W').\n2. Finde Makro-Zyklus und Subwellen.\n3. Erstelle diese Tabelle (nutze Schätzwerte für Wendepunkte): \n\n[Welle] | [Datum] | [Preis]" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ]
    })
  });
  
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.choices || !data.choices[0].message.content) throw new Error("Keine valide KI-Antwort: " + JSON.stringify(data));
  return data.choices[0].message.content;
}

// --- 4. TELEGRAM BOT HANDLER ---
bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;
  await ctx.reply("🔍 Analyse läuft (erzwinge Wellen-Zählung)...");

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const analysis = await getElliottAnalysis(base64Image);
    
    // Ticker & Timeframe auslesen
    const firstLine = analysis.split('\n')[0];
    const match = firstLine.match(/([A-Z]{2,6}).*?(1W|1D|1M|4h)/i);
    const symbol = match ? match[1].toUpperCase() : "ADBE"; 
    const timeframe = match ? match[2] : "1W";

    await ctx.reply(`🧠 Text-Analyse abgeschlossen. Hole Marktdaten für ${symbol} (${timeframe}) und zeichne Chart...`);

    const waves = parseWavesFromTable(analysis);
    const candles = await fetchYahooData(symbol, timeframe);

    if (waves.length < 2) {
        await ctx.reply(`⚠️ Die KI hat keine sauber formatierte Tabelle geliefert. Hier ist der reine Text:\n\n${analysis.substring(0, 4000)}`);
        return;
    }

    // Python Skript aufrufen
    const pyProcess = spawn("python3", ["python_service/drawer.py", JSON.stringify({ candles, waves })]);
    
    let imgBuffer = Buffer.alloc(0);
    let errorData = "";

    pyProcess.stdout.on("data", (chunk) => imgBuffer = Buffer.concat([imgBuffer, chunk]));
    pyProcess.stderr.on("data", (chunk) => errorData += chunk.toString());

    pyProcess.on("close", async (code) => {
        if (code !== 0 || imgBuffer.length === 0) {
            await ctx.reply(`❌ Zeichnen fehlgeschlagen. Python-Fehler:\n${errorData}`);
        } else {
            // Chart als Bild senden und die KI-Analyse als Text drunter
            await ctx.replyWithPhoto({ source: imgBuffer }, { caption: `✅ Magnet-Snapping erfolgreich für ${symbol}.` });
            await ctx.reply(analysis.substring(0, 4000));
        }
    });

  } catch (err: any) {
    await ctx.reply("❌ Fehler: " + err.message);
  }
});

// --- 5. WEBHOOKS ---
if (process.env.RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}${webhookPath}`);
    server.on('request', (req, res) => {
        if (req.url === webhookPath && req.method === "POST") {
            let body = "";
            req.on("data", c => body += c);
            req.on("end", () => bot.handleUpdate(JSON.parse(body), res));
        }
    });
} else {
    bot.launch();
}
