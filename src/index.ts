import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

// Hilfsfunktion zur Bereinigung der KI-Antwort
function parseWavesFromText(text: string): Array<{ label: string; date: string }> {
  const waves: Array<{ label: string; date: string }> = [];
  const regex = /\[(?:Welle\s+)?([12345a-cA-CWXYIViv]+):\s*(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2})?)\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    waves.push({ label: match[1].trim().toUpperCase(), date: match[2].trim() });
  }
  return waves;
}

bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;
  await ctx.reply("📥 Lade Screenshot & Analysiere mit Llama...");

  try {
    // 1. Bild verarbeiten
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    // 2. Groq-API Aufruf (Llama-3.2-Vision)
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.2-90b-vision-preview",
        messages: [{ role: "user", content: [
          { type: "text", text: "Analysiere den EW-Chart. Liste Makro-Zyklus (I-V, A-C) und alle Subwellen (1-5, a-c) tabellarisch mit Datum auf." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ]}]
      })
    });
    const result = await response.json();
    const analysis = result.choices[0].message.content;
    await ctx.reply(analysis.substring(0, 4000));

    // 3. Yahoo Datenabruf (Intervall-Logik)
    const symbol = "ADBE"; // Hier könntest du die OCR-Extraktion verfeinern
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1wk&range=5y`;
    const yRes = await fetch(yahooUrl);
    const yData = await yRes.json();
    const candles = yData.chart.result[0].indicators.quote[0];

    // 4. Drawer.py Aufruf
    const waves = parseWavesFromText(analysis);
    const py = spawn("python3", ["python_service/drawer.py", JSON.stringify({ waves, candles })]);
    let imgBuf = Buffer.alloc(0);
    py.stdout.on("data", (c) => imgBuf = Buffer.concat([imgBuf, c]));
    py.on("close", () => ctx.replyWithPhoto({ source: imgBuf }, { caption: "📊 Struktur-Analyse" }));

  } catch (err: any) {
    ctx.reply("❌ Fehler: " + err.message);
  }
});

// Server-Boilerplate
if (RENDER_EXTERNAL_URL) {
  const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
  bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
  http.createServer((req, res) => {
    if (req.url === webhookPath && req.method === "POST") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => bot.handleUpdate(JSON.parse(body), res));
    } else { res.writeHead(200); res.end("OK"); }
  }).listen(PORT);
} else { bot.launch(); }
