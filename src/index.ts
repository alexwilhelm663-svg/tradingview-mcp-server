import { GoogleGenAI } from "@google/genai";
import { chromium } from "playwright";

// Korrigiert: Das SDK benötigt zwingend ein Konfigurationsobjekt bei der Instanziierung
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function runChartAnalysis(symbol: string, interval: string = "1h") {
  console.log(`🚀 Starte Browser-Automation für ${symbol} (${interval})...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}&interval=${interval}`;

  try {
    // 1. Chart im Headless-Browser aufrufen
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    console.log("📊 Chart geladen. Warte 5 Sekunden auf Indikatoren...");
    await page.waitForTimeout(5000); 

    // 2. Screenshot als Buffer aufnehmen
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 90 });
    console.log("📸 Screenshot erfolgreich erstellt.");
    await browser.close();

    // 3. Bild für die Gemini API vorbereiten
    const imagePart = {
      inlineData: {
        data: screenshotBuffer.toString("base64"),
        mimeType: "image/jpeg"
      },
    };

    console.log("🧠 Sende Daten an Gemini für die technische Analyse...");

    // 4. Gemini die visuelle Analyse übergeben
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro", // Bestes Modell für mathematisch-visuelle Mustererkennung
      contents: [
        imagePart,
        "Du bist ein professioneller Krypto- und Aktien-Analyst. Analysiere diesen TradingView-Chart im Detail. Achte besonders auf: 1) Marktstruktur (Trendrichtung, Support/Resistance), 2) Candlestick-Formationen an markanten Zonen, 3) Indikatoren und ggf. Chartmuster (z.B. Elliott-Wellen, Dreiecke oder Fibonacci-Level, sofern sichtbar). Gib mir ein klares, ungeschöntes charttechnisches Fazit."
      ],
    });

    console.log("\n================ GEMINI ANALYSE ================\n");
    console.log(response.text);
    console.log("\n================================================\n");

  } catch (error: any) {
    await browser.close();
    console.error("❌ Fehler während der Ausführung:", error.message);
  }
}

// Standardwerte aus den Umgebungsvariablen ziehen
const targetSymbol = process.env.TICKER || "BINANCE:BTCUSDT";
const targetInterval = process.env.INTERVAL || "1D";

runChartAnalysis(targetSymbol, targetInterval);
