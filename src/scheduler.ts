import cron from "node-cron";
import fs from "fs";
import path from "path";
import { analyzeAsset } from "./engine";
import { getRadarWatchlist } from "./radarManager";
import { GoogleGenerativeAI } from "@google/generative-ai";

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

async function sendTelegramAlert(symbol: string, message: string, imageBuffer: Buffer | null): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log(`[ALERT - KEIN TELEGRAM TOKEN/CHAT_ID] ${symbol}: ${message}`);
    return;
  }

  try {
    if (imageBuffer) {
      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("caption", message);
      formData.append("parse_mode", "Markdown");
      
      // FIX: Cast auf 'any' hebelt den unbegründeten TS-Compiler-Veto aus
      formData.append("photo", new Blob([imageBuffer as any], { type: "image/png" }), `${symbol}_EW.png`);

      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST",
        body: formData,
      });
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
      });
    }
  } catch (e: any) {
    console.error(`[TELEGRAM FEHLER] Konnte Alert für ${symbol} nicht senden:`, e.message);
  }
}

export async function runAutoScan(): Promise<void> {
  const currentWatchlist = getRadarWatchlist();
  console.log(`[${new Date().toISOString()}] Starte automatischen Radar-Scan für ${currentWatchlist.length} Assets...`);
  
  const state = loadState();
  const todayStr = new Date().toISOString().split("T")[0];

  for (const symbol of currentWatchlist) {
    try {
      if (state[symbol] && state[symbol].includes(todayStr)) {
        console.log(`[SKIP] ${symbol} wurde heute bereits gemeldet.`);
        continue;
      }

      console.log(`[SCAN] Analysiere ${symbol}...`);
      const result = await analyzeAsset(symbol, genAI);

      if (result.isHotSetup || result.isBreakoutSetup) {
        const alertMsg = result.isHotSetup ? result.killZoneStatus : result.breakoutStatus;
        await sendTelegramAlert(symbol, alertMsg, result.buffer);

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

// Cron-Job: Läuft alle 4 Stunden
cron.schedule("0 */4 * * *", () => {
  runAutoScan();
});

if (require.main === module) {
  runAutoScan();
}
