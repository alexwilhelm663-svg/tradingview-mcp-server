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

async function fetchYahooData(symbol: string, timeframe: string) {
    const interval = timeframe.toLowerCase().includes('w') ? '1wk' : '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=5y`;
    
    const res = await fetch(url);
    const data = await res.json();
    if (!data.chart.result) throw new Error(`Yahoo fand den Ticker ${symbol} nicht.`);
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    
    // Falls Yahoo zwar antwortet, aber keine Kerzen liefert (toter Ticker)
    if (!timestamps || timestamps.length === 0) return [];

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

function parseWavesFromTable(text: string) {
    const waves = [];
    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
            const label = parts[0].replace(/[\*\`\[\]]/g, ''); 
            let dateStr = parts[1].replace(/[\*\`\[\]]/g, '');
            const price = parseFloat(parts[2].replace(/[^0-9.,-]/g, '').replace(',', '.'));
            
            if (label.length > 0 && label.length <= 4 && !isNaN(price) && dateStr.match(/\d{4}/)) {
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

// --- 3. KI ANALYSE ---
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
            { type: "text", text: "1. Schreibe ZWINGEND als erste Zeile exakt dieses Format: 'Ticker: [SYMBOL], Timeframe: [WERT]'. (z.B. Ticker: AAPL, Timeframe: 1W).\n2. Finde Makro-Zyklus und Subwellen.\n3. Erstelle diese Tabelle (nutze Schätzwerte für Wendepunkte): \n\n[Welle] | [Datum] | [Preis]" },
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
    
    // NEU: Robuster Regex greift nur noch, wenn exakt das Wort "Ticker:" davor steht
    const tickerMatch = analysis.match(/Ticker:\s*([A-Z0-9.-]+)/i);
    const timeframeMatch = analysis.match(/Timeframe:\s*([A-Z0-9]+)/i);
    
    const symbol = tickerMatch ? tickerMatch[1].toUpperCase() : "TEAM"; 
    const timeframe = timeframeMatch ? timeframeMatch[1] : "1W";

    await ctx.reply(`🧠 Text-Analyse abgeschlossen. Hole Marktdaten für ${symbol} (${timeframe}) und zeichne Chart...`);

    const waves = parseWavesFromTable(analysis);
    const candles = await fetchYahooData(symbol, timeframe);

    // NEU: Bevor Python startet, prüfen wir, ob Yahoo echte Kerzen geliefert hat
    if (candles.length === 0) {
        throw new Error(`Yahoo Finance hat keine Preisdaten für den erkannten Ticker "${symbol}" geliefert. Wahrscheinlich hat die KI den Ticker nicht sauber erkannt.`);
    }

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
