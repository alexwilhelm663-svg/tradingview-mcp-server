// @ts-nocheck
import { ewAnalyzerWorkflow } from "./graph/ewValidator";
import db from "./db"; // Import aus deinem neuen Lern-Modul
import fs from "fs";
import path from "path";

export interface AnalysisResult {
  buffer: Buffer | null;
  signal: string;
  finalTrend: string;
  isHotSetup: boolean;
  killZoneStatus: string;
  isBreakoutSetup: boolean;
  breakoutStatus: string;
  analysis: any;
}

export async function analyzeAsset(symbol: string): Promise<AnalysisResult> {
  try {
    // 1. Lerneffekt: Statistik laden für den System-Kontext
    const statsPath = path.join(process.cwd(), 'knowledge/statistics/winrates.md');
    const stats = fs.existsSync(statsPath) ? fs.readFileSync(statsPath, 'utf-8') : "Keine Statistik verfügbar.";

    // 2. Daten abrufen
    const marketData = await fetchMarketData(symbol);
    const candles = marketData.weeklyAnalysisCandles;
    const currentPrice = parseFloat(candles[candles.length - 1].close);

    // 3. Workflow ausführen mit injiziertem Performance-Kontext
    const finalState = await ewAnalyzerWorkflow.invoke({
      symbol: symbol,
      marketData: candles,
      systemContext: `Aktuelle Performance-Daten: ${stats}. Nutze diese, um die Wahrscheinlichkeit für ein Setup zu validieren.`
    });

    if (!finalState.isValid || !finalState.waveCount) {
      throw new Error("Analyse-Engine lieferte kein valides Resultat.");
    }

    const p = finalState.waveCount.points;
    
    // 4. Setup-Logik
    let isHotSetup = false; let killZoneStatus = "";
    let isBreakoutSetup = false; let breakoutStatus = "";

    if (p.wave5 > p.start && currentPrice <= p.wave5 * 0.7) {
        isHotSetup = true;
        killZoneStatus = `🚨 KILL-ZONE HIT: Kurs befindet sich im Dip.`;
    }

    if (currentPrice >= p.wave1 && currentPrice <= p.wave1 * 1.1) {
        isBreakoutSetup = true;
        breakoutStatus = `🚀 AUSBRUCH über Welle-1-Niveau!`;
    }

    // 5. Lern-Modul: Signal in DB protokollieren
    if (isHotSetup || isBreakoutSetup) {
      const stmt = db.prepare("INSERT INTO trade_history (symbol, signal_type, entry_price) VALUES (?, ?, ?)");
      stmt.run(symbol, isHotSetup ? 'HOT' : 'BREAKOUT', currentPrice);
    }

    return {
      buffer: null,
      signal: (isHotSetup || isBreakoutSetup) ? "YES" : "NO",
      finalTrend: finalState.waveCount.trend,
      isHotSetup,
      killZoneStatus,
      isBreakoutSetup,
      breakoutStatus,
      analysis: finalState.waveCount
    };
  } catch (e) {
    console.error(`Analysefehler [${symbol}]:`, e);
    return {
      buffer: null, signal: "NO", finalTrend: "NONE",
      isHotSetup: false, killZoneStatus: "",
      isBreakoutSetup: false, breakoutStatus: "",
      analysis: null
    };
  }
}
