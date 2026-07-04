import cron from "node-cron";
import fs from "fs";
import path from "path";
import { analyzeAsset } from "./engine";
import { GoogleGenerativeAI } from "@google/generative-ai";

const WATCHLIST = ["BTC-USD", "ETH-USD", "TSLA", "AMD", "NVDA", "AAPL"];
const STATE_FILE = path.join(__dirname, "alert_state.json");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

interface AlertState {
  [symbol: string]: string[];
}

function loadState(): AlertState {
  if (!fs.existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch (e) {
    return {};
  }
}

function saveState(state: AlertState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

async function sendNotification(symbol: string, message: string, imageBuffer: Buffer | null) {
  console.log(`\n==============================================`);
  console.log(`[ALERT] ${symbol}: ${message}`);
  console.log(`==============================================\n`);
  
  // HIER TELEGRAM-BOT INTEGRATION EINTRAGEN (z.B. über grammy / telegraf / node-telegram-bot-api)
  // Beispiel:
  // if (imageBuffer) await telegramBot.sendPhoto(CHAT_ID, imageBuffer, { caption: message });
  // else await telegramBot.sendMessage(CHAT_ID, message);
}

export async function runAutoScan(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starte automatischen Radar-Scan für ${WATCHLIST.length} Assets...`);
  const state = loadState();
  const todayStr = new Date().toISOString().split("T")[0];

  for (const symbol of WATCHLIST) {
    try {
      if (state[symbol] && state[symbol].includes(todayStr)) {
        console.log(`[SKIP] ${symbol} wurde heute bereits gemeldet.`);
        continue;
      }

      console.log(`[SCAN] Analysiere ${symbol}...`);
      const result = await analyzeAsset(symbol, genAI);

      if (result.isHotSetup || result.isBreakoutSetup) {
        const alertMsg = result.isHotSetup ? result.killZoneStatus : result.breakoutStatus;
        await sendNotification(symbol, alertMsg, result.buffer);

        if (!state[symbol]) state[symbol] = [];
        state[symbol].push(todayStr);
        saveState(state);
      } else {
        console.log(`[OK] ${symbol}: Kein aktives Setup (${result.finalTrend}).`);
      }
    } catch (err: any) {
      console.error(`[FEHLER] Scan fehlgeschlagen bei ${symbol}:`, err.message);
    }
  }
  console.log(`[${new Date().toISOString()}] Automatischer Radar-Scan abgeschlossen.`);
}

cron.schedule("0 */4 * * *", () => {
  runAutoScan();
});

if (require.main === module) {
  runAutoScan();
}

