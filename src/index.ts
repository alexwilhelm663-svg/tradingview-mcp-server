import { Telegraf } from "telegraf";
import http from "http";

// 1. Webserver SOFORT starten (Verhindert Render-Crash/SIGTERM)
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running!");
});
server.listen(PORT, () => console.log(`🚀 Port ${PORT} ist offen!`));

// 2. Telegram Bot initialisieren
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

// 3. Zentrale Analyse-Logik (Groq/Llama Vision - Keine externen SDKs nötig)
async function getElliottAnalysis(base64Image: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { 
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
        "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      model: "llama-3.2-90b-vision-preview",
      messages: [{ role: "user", content: [
        { type: "text", text: "Lies Ticker & Timeframe unten links. Analysiere EW (I-V, A-C, Subwellen 1-5, a-c). Erstelle Tabelle: [Welle] | [Datum] | [Preis]." },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
      ]}]
    })
  });
  const data = await response.json();
  if (!data.choices || !data.choices[0].message.content) throw new Error("Keine valide KI-Antwort.");
  return data.choices[0].message.content;
}

// 4. Bot-Event-Handler
bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;

  await ctx.reply("📥 Lade Screenshot & analysiere via Groq...");

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const analysis = await getElliottAnalysis(base64Image);
    await ctx.reply(`📊 Ergebnis:\n\n${analysis.substring(0, 4000)}`);
    
  } catch (err: any) {
    ctx.reply("❌ Analyse-Fehler: " + err.message);
  }
});

// 5. Webhook an Server hängen
if (RENDER_EXTERNAL_URL) {
    const webhookPath = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${RENDER_EXTERNAL_URL}${webhookPath}`);
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
