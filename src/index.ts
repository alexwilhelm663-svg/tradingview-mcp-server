import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { chromium } from "playwright";

const server = new Server(
  {
    name: "tradingview-browser-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Definition der Tools, die der KI zur Verfügung stehen
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_chart_screenshot",
        description: "Öffnet einen TradingView-Chart und macht einen Screenshot für die visuelle Analyse.",
        inputSchema: {
          type: "object",
          properties: {
            symbol: { type: "string", description: "z.B. BINANCE:BTCUSDT oder NASDAQ:TSLA" },
            interval: { type: "string", description: "Zeitrahmen, z.B. 1m, 5m, 1h, 1D, 1W" }
          },
          required: ["symbol"]
        }
      }
    ]
  };
});

// Logik zur Ausführung der Tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "get_chart_screenshot") {
    throw new Error("Tool nicht gefunden");
  }

  const { symbol, interval } = request.params.arguments as { symbol: string; interval?: string };
  
  // Formatierung der URL für den TradingView Chart
  const tvInterval = interval ? `?interval=${interval}` : "";
  const url = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}${tvInterval}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    
    // Warte kurz, bis sich die Indikatoren/Kerzen geladen haben
    await page.waitForTimeout(5000); 

    // Screenshot als Base64 für das LLM aufnehmen
    const screenshotBuffer = await page.screenshot({ type: "jpeg", quality: 85 });
    const base64Screenshot = screenshotBuffer.toString("base64");

    await browser.close();

    return {
      content: [
        {
          type: "text",
          text: `Screenshot für ${symbol} erfolgreich geladen. Siehe angehängtes Bild.`
        },
        {
          type: "image",
          data: base64Screenshot,
          mimeType: "image/jpeg"
        }
      ]
    };
  } catch (error: any) {
    await browser.close();
    return {
      isError: true,
      content: [{ type: "text", text: `Fehler beim Scrapen von TradingView: ${error.message}` }]
    };
  }
});

// Server via Stdio starten (Standard für MCP)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("TradingView Browser MCP server läuft auf stdio");

