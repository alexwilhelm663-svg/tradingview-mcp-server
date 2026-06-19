import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot alive");
});
server.listen(PORT, () => console.log(`🚀 Server auf Port ${PORT} gestartet.`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

process.on('uncaughtException', (err) => console.error('FATAL:', err));
process.on('unhandledRejection', (err) => console.error('PROMISE FAIL:', err));

async function fetchYahooData(symbol: string, timeframe: string) {
    const interval = timeframe.toLowerCase().includes('w') ? '1wk' : '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=${interval}&range=max`;
    
    const res = await fetch(url);
    const data = await res.json();
    
    // DEBUG 1: Falls Yahoo komplett blockt oder Mist liefert
    if (!data.chart || !data.chart.result) {
        throw new Error(`Yahoo API Struktur fehlerhaft. Antwort war: ${JSON.stringify(data).substring(0, 500)}`);
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    if (!timestamps || timestamps.length === 0) return [];

    const quote = result.indicators.quote[0];
    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
        if (quote.open && quote.close && quote.open[i] !== null && quote.close[i] !== null) {
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
    let fallbackMonth = 1;

    for (const line of lines) {
        if (!line.includes('|')) continue;
        
        const parts = line.split('|').map(p => p.trim()).filter(p => p !== '');
        if (parts.length >= 3 && !parts[0].includes('---') && !parts[0].toLowerCase().includes('welle')) {
            const label = parts[0].replace(/[\*\`\[\]]/g, '').trim(); 
            let dateStr = parts[1].replace(/[\*\`\[\]]/g, '').trim();
            
            const priceMatch = parts[2].match(/[-0-9.,]+/);
            if (!priceMatch) continue;
            const price = parseFloat(priceMatch[0].replace(',', '.'));
            
            if (label.length > 0 && label.length <= 30 && !isNaN(price)) {
                const exactMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
                if (exactMatch) {
                    dateStr = exactMatch[0];
                } else {
                    const ymMatch = dateStr.match(/(\d{4})-(\d{2})/);
                    if (ymMatch) {
                        dateStr = `${ymMatch[1]}-${ymMatch[2]}-15`;
                    } else {
                        const yMatch = dateStr.match(/\d{4}/);
                        if (yMatch) {
                            const month = String(fallbackMonth).padStart(2, '0');
                            dateStr = `${yMatch[0]}-${month}-15`;
                            fallbackMonth = fallbackMonth >= 11 ? 1 : fallbackMonth + 2; 
                        } else {
                            continue;
                        }
                    }
                }
                waves.push({ label, date: dateStr, price });
            }
        }
    }
    return waves;
}

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
          content: "Du bist Analyst. Du MUSST Charts analysieren. Schätze Preise und Daten anhand der Achsen bestmöglich ab. Verweigere nie die Antwort." 
        },
        { 
          role: "user", 
          content: [
            { type: "text", text: "1. Schreibe ZWINGEND als erste Zeile exakt dieses Format: 'Ticker: [SYMBOL], Timeframe: [WERT]'.\n2. Finde Makro-Zyklus und Subwellen.\n3. Erstelle diese Tabelle. Schätze das Datum ZWINGEND im exakten Format YYYY-MM-DD oder zumindest YYYY-MM:\n\n[Welle] | [Datum] | [Preis]" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ]
    })
  });
  
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.choices || !data.choices[0].message.content) throw new Error("Keine valide KI-Antwort erhalten.");
  return data.choices[0].message.content;
}

bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;
  await ctx.reply("🔍 Analyse läuft...");

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const analysis = await getElliottAnalysis(base64Image);
    
    const tickerMatch = analysis.match(/Ticker:\s*([A-Z0-9.-]+)/i);
    const timeframeMatch = analysis.match(/Timeframe:\s*([A-Z0-9]+)/i);
    
    const symbol = tickerMatch ? tickerMatch[1].toUpperCase() : "TEAM"; 
    const timeframe = timeframeMatch ? timeframeMatch[1] : "1W";

    const waves = parseWavesFromTable(analysis);
    const candles = await fetchYahooData(symbol, timeframe);

    // DEBUG 2: Was genau wurde geparst? Direkte Ausgabe im Chat bei Fehlern
    if (candles.length === 0 || waves.length < 2) {
        await ctx.reply(`🚨 CRITICAL DEBUG INFO:\n\n` +
                        `• Erkanntes Symbol: "${symbol}"\n` +
                        `• Erkannter Timeframe: "${timeframe}"\n` +
                        `• Kerzen von Yahoo erhalten: ${candles.length}\n` +
                        `• Wellen aus Tabelle geparst: ${waves.length}\n\n` +
                        `• Geparste Wellen-Daten:\n${JSON.stringify(waves, null, 2)}\n\n` +
                        `• Roher KI-Text:\n${analysis.substring(0, 1500)}`);
        return;
    }

    await ctx.reply(`🧠 Daten valide. Starte Python-Rendering für ${symbol}...`);

    const pyProcess = spawn("python3", ["python_service/drawer.py"]);
    
    pyProcess.stdin.write(JSON.stringify({ candles, waves }));
    pyProcess.stdin.end();
    
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
    await ctx.reply("❌ Laufzeit-Fehler: " + err.message);
  }
});

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
