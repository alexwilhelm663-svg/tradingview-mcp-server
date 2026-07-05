// @ts-nocheck
import { ewAnalyzerWorkflow } from "./ewValidator (1)";

export async function analyzeAsset(symbol: string) {
  try {
    // 1. Daten-Pipeline (fetchVanillaYahooCandles / fetchKrakenCandles)
    const marketData = await fetchMarketData(symbol); 
    
    // 2. Workflow ausführen
    const finalState = await ewAnalyzerWorkflow.invoke({
      symbol: symbol,
      marketData: marketData.weeklyAnalysisCandles
    });

    if (!finalState.isValid) throw new Error("Keine valide Zählung.");

    // 3. Dispatch / Drawer
    return {
      analysis: finalState.waveCount,
      signal: finalState.waveCount.trend
    };
  } catch (e) {
    console.error(`Analysefehler [${symbol}]:`, e);
    return { signal: "NO" };
  }
}
