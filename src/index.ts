import { Telegraf } from "telegraf";
import http from "http";

const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => { res.writeHead(200); res.end("Bot alive"); });
server.listen(PORT, () => console.log(`🚀 Port ${PORT} offen.`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Fehler-Fänger für den gesamten Prozess (verhindert SIGTERM)
process.on('uncaughtException', (err) => console.error('FATAL:', err));
process.on('unhandledRejection', (err) => console.error('PROMISE FAIL:', err));

bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;
  await ctx.reply("🔍 Analyse läuft...");

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.2-90b-vision-preview",
        messages: [{ role: "user", content: [
          { type: "text", text: "Lies Ticker & Timeframe unten links. Erstelle Tabelle: [Welle] | [Datum] | [Preis]." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
        ]}]
      })
    });

    const data = await response.json();
    
    // Transparente Fehler-Ausgabe, falls Groq zickt
    if (!data.choices) {
        throw new Error("Groq API Fehler: " + JSON.stringify(data));
    }

    const analysis = data.choices[0].message.content;
    await ctx.reply(analysis.substring(0, 4000));

  } catch (err: any) {
    // Schicke den Fehler in den Chat, damit du siehst, warum es nicht geht
    await ctx.reply("❌ Fehler: " + err.message);
  }
});

// Webhook-Logik
if (process.env.RENDER_EXTERNAL_URL) {
    const path = `/telegraf/${bot.secretPathComponent()}`;
    bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}${path}`);
    server.on('request', (req, res) => {
        if (req.url === path && req.method === "POST") {
            let body = "";
            req.on("data", c => body += c);
            req.on("end", () => bot.handleUpdate(JSON.parse(body), res));
        }
    });
} else {
    bot.launch();
}
