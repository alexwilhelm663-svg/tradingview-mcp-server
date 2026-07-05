// @ts-nocheck
import { runAnalysisEngine } from "./engine";

// Beispiel-Hilfsfunktion für das Zeichnen (simuliert deinen SVG/Matplotlib Chart-Builder)
function generateChartConfig(chartData: any) {
  return {
    symbol: chartData.symbol,
    status: chartData.status,
    points: chartData.points,
    levels: chartData.drawLevels
  };
}

export async function executeRadarScan(symbols: string[], fetchMarketData: (sym: string) => Promise<any>) {
  console.log(`[Radar] Starte Scan für ${symbols.length} Symbole...`);
  const hits = [];

  for (const symbol of symbols) {
    try {
      const data = await fetchMarketData(symbol);
      const { error, result } = await runAnalysisEngine(symbol, data.currentPrice, data);

      if (error || !result) {
        console.log(`[Radar] Überspringe ${symbol}: ${error}`);
        continue;
      }

      // Wenn ein echter Ausbruch oder ein relevantes Setup vorliegt -> Hit speichern
      if (result.alertType !== "NONE") {
        hits.push({
          symbol,
          price: result.price,
          type: result.alertType,
          message: result.alertMsg,
          analysis: result.waveCount.analysis,
          chart: generateChartConfig(result.chart)
        });
      }
    } catch (err) {
      console.error(`[Radar] Fehler bei ${symbol}:`, err);
    }
  }

  console.log(`[Radar] Scan beendet. ${hits.length} Signale gefunden.`);
  return hits;
}
