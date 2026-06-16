import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const PORT = process.env.PORT || 10000;

// Native Fetch-Funktion für API-Aufrufe ohne externe SDKs
async function askLLM(prompt: string, base64Image: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.2-90b-vision-preview",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ]
      }]
    })
  });
  const data = await response.json();
  return data.choices[0].message.content;
}

bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;

  await ctx.reply("🧠 Analysiere Chart mit Groq-Llama...");

  // Bild zu Base64
  const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
  const buffer = await (await fetch(fileLink.href)).arrayBuffer();
  const base64Image = Buffer.from(buffer).toString("base64");

  // Analyse-Aufruf
  try {
    const analysis = await askLLM("Lies Ticker/Timeframe unten links. Analysiere Elliott-Wellen Makro (I-V, A-C) und alle Subwellen (1-5, a-c). Markiere Punkte mit [Welle: Datum].", base64Image);
    await ctx.reply(analysis.substring(0, 4000));
    
    // ... (Hier wie gehabt Yahoo Datenabruf und Aufruf von drawer.py)
  } catch (e: any) {
    ctx.reply("❌ Analyse-Fehler: " + e.message);
  }
});

// Webhook-Boilerplate wie gehabt...
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
