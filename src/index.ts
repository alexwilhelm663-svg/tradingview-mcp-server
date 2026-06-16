import OpenAI from "openai";
import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const openai = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1"
});

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

console.log("🤖 Multimodaler Bot läuft. Groq-API (Llama-3.2-Vision) aktiv...");

bot.catch((err, ctx) => {
  console.error("⚠️ Bot-Fehler:", err);
});

bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;

  await ctx.reply("📥 Lade Chart und berechne Elliott-Wellen via Groq...");

  // 1. Bild zu Base64
  const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
  const imageResponse = await fetch(fileLink.href);
  const base64Image = Buffer.from(await imageResponse.arrayBuffer()).toString("base64");

  // 2. Analyse via Llama-3.2-90b-vision
  try {
    const response = await openai.chat.completions.create({
      model: "llama-3.2-90b-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Du bist ein Elliott-Wellen Profi. 
            Aufgabe: Analysiere den Chart. Identifiziere den Makro-Zyklus (I, II, III, IV, V, A, B, C) und AKRIBISCH ALLE Subwellen (1,2,3,4,5 bzw a,b,c).
            Regel: Allzeithoch ist Welle V. Markiere Wendepunkte mit [Welle Name: YYYY-MM-DD].
            Antworte detailliert und liste alle gefundenen Wellen mit Datum auf.` },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
          ]
        }
      ]
    });

    const analysisText = response.choices[0].message.content || "";
    await ctx.reply(analysisText.substring(0, 4000));

    // 3. Yahoo Daten für die Visualisierung abrufen (vereinfacht)
    // Extrahiere hier Ticker aus analysisText oder nutze fallback
    const symbol = "BTC-USD"; // Beispiel-Fallback
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`;
    const yResponse = await fetch(yahooUrl);
    const yData = await yResponse.json();
    
    // 4. Drawer.py Aufruf
    const drawerInput = JSON.stringify({ analysis: analysisText, data: yData.chart.result[0].indicators.quote[0] });
    const py = spawn("python3", ["python_service/drawer.py", drawerInput]);
    
    let imgBuffer = Buffer.alloc(0);
    py.stdout.on("data", (c) => imgBuffer = Buffer.concat([imgBuffer, c]));
    py.on("close", () => {
      ctx.replyWithPhoto({ source: imgBuffer }, { caption: "📊 Struktur-Analyse abgeschlossen" });
    });

  } catch (err: any) {
    ctx.reply("❌ Fehler: " + err.message);
  }
});

// Webhook-Server
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
