import { Telegraf } from "telegraf";
import { spawn } from "child_process";
import http from "http";

// 1. Webserver SOFORT starten (Verhindert Render-Crash/SIGTERM)
const PORT = process.env.PORT || 10000;
const server = http.createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot alive");
});
server.listen(PORT, () => console.log(`🚀 Server auf Port ${PORT} gestartet.`));

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Fehler-Fänger für den gesamten Prozess
process.on('uncaughtException', (err) => console.error('FATAL:', err));
process.on('unhandledRejection', (err) => console.error('PROMISE FAIL:', err));

// 2. Zentrale Analyse-Logik (Native Fetch, kein SDK)
async function getElliottAnalysis(base64Image: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { 
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
        "Content-Type": "application/json" 
    },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct", // Das offiziell unterstützte Vision-Modell
      messages: [{ role: "user", content: [
        { type: "text", text: "Lies Ticker & Timeframe unten links. Erstelle Tabelle: [Welle] | [Datum] | [Preis]." },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
      ]}]
    })
  });
  
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  if (!data.choices || !data.choices[0].message.content) throw new Error("Keine valide KI-Antwort erhalten. API-Antwort: " + JSON.stringify(data));
  return data.choices[0].message.content;
}

// 3. Bot-Event-Handler
bot.on("photo", async (ctx) => {
  if (!ctx.message.caption?.toLowerCase().startsWith("/analyse")) return;

  await ctx.reply("🔍 Analyse läuft...");

  try {
    const fileLink = await ctx.telegram.getFileLink(ctx.message.photo[ctx.message.photo.length - 1].file_id);
    const buffer = await (await fetch(fileLink.href)).arrayBuffer();
    const base64Image = Buffer.from(buffer).toString("base64");

    const analysis = await getElliottAnalysis(base64Image);
    await ctx.reply(`📊 Ergebnis:\n\n${analysis.substring(0, 4000)}`);
    
    // Yahoo & Python Integration (nur falls benötigt)
    // const py = spawn("python3", ["python_service/drawer.py", JSON.stringify({ analysis })]);
    
  } catch (err: any) {
    await ctx.reply("❌ Fehler: " + err.message);
  }
});

// 4. Webhook an Server hängen
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
