import fs from "fs";
import path from "path";
import db from "./db";
import { fetchMarketData } from "./marketData";
import { renderChart } from "./chart";
import { ewAnalyzerWorkflow, WaveCount, WavePoint } from "../graph/ewValidator";

export interface AnalysisResult {
  buffer: Buffer | null;
  signal: "YES" | "NO";
  finalTrend: string;
  isHotSetup: boolean;
  killZoneStatus: string;
  isBreakoutSetup: boolean;
  breakoutStatus: string;
  analysis: WaveCount | null;
}

const EMPTY: AnalysisResult = {
  buffer: null,
  signal: "NO",
  finalTrend: "NONE",
  isHotSetup: false,
  killZoneStatus: "",
  isBreakoutSetup: false,
  breakoutStatus: "",
  analysis: null,
};

function pt(wc: WaveCount, label: string): WavePoint | undefined {
  return wc.points.find((p) => p.label === label);
}

export async function analyzeAsset(symbol: string): Promise<AnalysisResult> {
  try {
    // 1. Lern-Kontext: aktuelle Erfolgsbilanz laden
    const statsPath = path.join(process.cwd(), "knowledge/statistics/winrates.md");
    const stats = fs.existsSync(statsPath)
      ? fs.readFileSync(statsPath, "utf-8")
      : "Keine Statistik verfuegbar.";

    // 2. Marktdaten (Weekly, 5 Jahre)
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(symbol);
    const currentPrice = candles[candles.length - 1].close;

    // 3. LangGraph-Workflow (Checkpointer braucht eine thread_id!)
    const finalState = await ewAnalyzerWorkflow.invoke(
      {
        symbol,
        marketData: candles,
        systemContext: `Aktuelle Performance-Daten:\n${stats}\nNutze diese, um die Wahrscheinlichkeit des Setups zu gewichten.`,
      },
      { configurable: { thread_id: `${symbol}-${Date.now()}` } }
    );

    if (!finalState.isValid || !finalState.waveCount) {
      console.warn(
        `[ENGINE] ${symbol}: keine valide Zaehlung nach ${finalState.attempts} Versuchen. Fehler: ${finalState.errorLogs.join(" | ")}`
      );
      return EMPTY;
    }

    const wc = finalState.waveCount as WaveCount;
    const w0 = pt(wc, "0");
    const w1 = pt(wc, "1");
    const w2 = pt(wc, "2");
    const w5 = pt(wc, "5");

    // 4. Setup-Logik mit EINGEFRORENEN Leveln (kein Signal ohne Invalidierung & Fib-Target)
    let isHotSetup = false;
    let killZoneStatus = "";
    let isBreakoutSetup = false;
    let breakoutStatus = "";
    let invalidation: number | null = null;
    let target: number | null = null;

    if (w0 && w5 && w5.price > w0.price && currentPrice <= w5.price * 0.7) {
      isHotSetup = true;
      killZoneStatus = `🚨 KILL-ZONE HIT: Kurs (${currentPrice.toFixed(2)}) notiert ≥30% unter dem Welle-5-Top (${w5.price.toFixed(2)}).`;
      invalidation = w0.price; // Bruch des Zyklus-Ursprungs = These tot
      target = w5.price; // Rueckkehr zum alten Hoch
    }

    if (w1 && currentPrice >= w1.price && currentPrice <= w1.price * 1.1) {
      isBreakoutSetup = true;
      breakoutStatus = `🚀 AUSBRUCH ueber Welle-1-Niveau (${w1.price.toFixed(2)})!`;
      if (w0 && w2) {
        invalidation = w2.price; // unter Welle-2-Tief = 1-2-Setup invalidiert
        target = w2.price + 1.618 * (w1.price - w0.price); // klassische Welle-3-Projektion
      }
    }

    // 5. Signal nur protokollieren, wenn beide Level sauber ableitbar sind
    if ((isHotSetup || isBreakoutSetup) && invalidation !== null && target !== null) {
      db.prepare(
        "INSERT INTO trade_history (symbol, signal_type, entry_price, invalidation, target) VALUES (?, ?, ?, ?, ?)"
      ).run(symbol, isBreakoutSetup ? "BREAKOUT" : "HOT", currentPrice, invalidation, target);
    }

    // 6. Chart rendern (drawer.py) - schlaegt das fehl, bleibt die Analyse textbasiert
    const buffer = await renderChart({ symbol, waves: wc.points, candles });

    return {
      buffer,
      signal: isHotSetup || isBreakoutSetup ? "YES" : "NO",
      finalTrend: wc.trend,
      isHotSetup,
      killZoneStatus,
      isBreakoutSetup,
      breakoutStatus,
      analysis: wc,
    };
  } catch (err: any) {
    console.error(`[ENGINE] Analysefehler ${symbol}:`, err?.message ?? err);
    return EMPTY;
  }
}
