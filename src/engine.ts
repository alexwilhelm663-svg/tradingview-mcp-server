// @ts-nocheck
import { ewAnalyzerWorkflow } from "./graph/ewValidator";

export async function analyzeAsset(symbol: string, currentPrice: number = 0, marketSummary: any = {}) {
  console.log(`[Engine] Starte Analyse für ${symbol} bei Kurs $${currentPrice}`);

  const config = { configurable: { thread_id: `thread-${symbol}-${Date.now()}` } };
  const inputState = {
    symbol,
    marketData: { currentPrice, ...marketSummary },
    attempts: 0,
    errorLogs: []
  };

  const finalState = await ewAnalyzerWorkflow.invoke(inputState, config);
  const waveCount = finalState.waveCount;

  if (!finalState.isValid || !waveCount) {
    return { error: `Keine valide Zählung für ${symbol} möglich.`, result: null };
  }

  const p = waveCount.points;
  const t = waveCount.targets || {};
  let alertType = "NONE";
  let alertMsg = "";

  if (waveCount.status === "in_progress") {
    if (currentPrice > p.wave3) {
      alertType = "BREAKOUT_WAVE_3";
      alertMsg = `🚀 **AUSBRUCH BESTÄTIGT:** Kurs (${currentPrice}$) schließt über dem Welle-3-Widerstand (${p.wave3}$)! Welle 5 Extension ist aktiv.`;
    } else {
      alertType = "WAVE_4_PULLBACK";
      alertMsg = `⏳ **SETUP AKTIV:** Kurs im Welle-4 Pullback. Nächstes Ziel ist Ausbruch über ${p.wave3}$.`;
    }
  } else if (waveCount.status === "completed") {
    alertType = "CORRECTION_ACTIVE";
    alertMsg = `📉 **IMPULS ABGESCHLOSSEN:** Welle 5 am Top (${p.wave5}$) beendet. Korrekturrücklauf in Richtung Golden Pocket (${t.ret618 || "N/A"}$) erwartet.`;
  }

  const chartConfig = {
    symbol,
    points: p,
    status: waveCount.status,
    drawLevels: waveCount.status === "in_progress" 
      ? { type: "EXTENSION", ext100: t.ext100, ext1618: t.ext1618 }
      : { type: "RETRACEMENT", ret382: t.ret382, ret500: t.ret500, ret618: t.ret618 }
  };

  return {
    error: null,
    result: {
      symbol,
      price: currentPrice,
      waveCount,
      alertType,
      alertMsg,
      chart: chartConfig
    }
  };
}
