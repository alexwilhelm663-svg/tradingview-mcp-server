import { spawn } from "child_process";

console.log("⚡ ========================================================");
console.log("⚡ THE QUANT RADAR: Hunting the 'Third of a Third' (v1.0)");
console.log("⚡ ========================================================");

// Das hochexplosive Standard-Universum (Jederzeit erweiterbar)
const UNIVERSE = [
  // AI & US Tech Prime
  "NVDA", "TSLA", "PLTR", "AMD", "ARM", "SMCI", "APP", "DDOG", "CRWD", "PANW", 
  // Crypto & High Beta Proxies
  "MSTR", "COIN", "HOOD", "MARA", "CLSK", "RIVN", "SHOP", "SE", "UBER", "CELH",
  // S&P 500 Giants & Momentum
  "AMZN", "META", "GOOGL", "AAPL", "NFLX", "AVGO", "QCOM", "NOW", "INTU", "GE",
  // German High-Beta & Volatility
  "SAP", "P911.DE", "RHM.DE", "ZAL.DE", "IFX.DE", "ENR.DE", "AIXA.DE", "EVT.DE"
];

interface RadarHit { symbol: string; currentPrice: number; subHigh: number; distancePct: number; }

async function fetchDailyCandles(symbol: string): Promise<any[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
  if (!res.ok) return [];
  
  const raw = await res.json();
  const timestamps = raw.chart?.result?.[0]?.timestamp || [];
  const quote = raw.chart?.result?.[0]?.indicators?.quote?.[0] || {};
  
  const candles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null) continue;
    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      high: parseFloat(quote.high[i]),
      low: parseFloat(quote.low[i]),
      close: parseFloat(quote.close[i])
    });
  }
  return candles;
}

// DAS EUKLIDISCHE KASKADEN-FILTER
function testThirdOfThirdCoiling(candles: any[]): { primed: boolean; subHigh?: number; dist?: number } {
  if (candles.length < 100) return { primed: false };

  // 1. Definiere Makro-Skala über das erste Halbjahr
  const firstHalf = candles.slice(0, Math.floor(candles.length * 0.6));
  let l0 = firstHalf[0];
  for (const c of firstHalf) if (c.low < l0.low) l0 = c;

  const postL0 = candles.slice(candles.indexOf(l0));
  if (postL0.length < 50) return { primed: false };

  // Makro Gipfel H1
  let h1 = postL0[0];
  for (const c of postL0) if (c.high > h1.high) h1 = c;

  const postH1 = postL0.slice(postL0.indexOf(h1));
  if (postH1.length < 20) return { primed: false };

  // Makro Tal L2
  let l2 = postH1[0];
  for (const c of postH1) if (c.low < l2.low) l2 = c;

  // PRÜFUNG 1: Ist Tal L2 mathematisch valide?
  if (l2.low <= l0.low) return { primed: false }; // Retracement Bruch
  
  const wave1Diff = h1.high - l0.low;
  const retracementDrop = h1.high - l2.low;
  const retracementRatio = retracementDrop / wave1Diff;
  
  // Muss im Fibonacci-Band 38.2% - 78.6% liegen
  if (retracementRatio < 0.35 || retracementRatio > 0.82) return { primed: false };

  // 2. DAS INNERE FRAKTAL (Die Startrampe nach Tal L2)
  const launchpad = postH1.slice(postH1.indexOf(l2) + 1);
  if (launchpad.length < 10) return { primed: false };

  // Sub-Welle 1 Gipfel
  let subH1 = launchpad[0];
  for (const c of launchpad) if (c.high > subH1.high) subH1 = c;

  // Der Sub-Gipfel DARF das Makro-Top noch nicht durchbrochen haben!
  if (subH1.high >= h1.high) return { primed: false };

  // Sub-Welle 2 Tal (Muss über L2 liegen!)
  const postSubH1 = launchpad.slice(launchpad.indexOf(subH1) + 1);
  if (postSubH1.length < 3) return { primed: false };

  let subL2 = postSubH1[0];
  for (const c of postSubH1) if (c.low < subL2.low) subL2 = c;

  if (subL2.low <= l2.low) return { primed: false };

  // 3. DER ZÜNDABSTAND (Sitzt der Kurs auf der Lunte?)
  const lastClose = candles[candles.length - 1].close;
  const distFromIgnition = (lastClose - subH1.high) / subH1.high;

  // Zündfenster: Maximal 3.5% darunter, maximal 1.5% darüber
  if (distFromIgnition >= -0.035 && distFromIgnition <= 0.015) {
    return { primed: true, subHigh: subH1.high, dist: distFromIgnition * 100 };
  }

  return { primed: false };
}

async function runRadar() {
  const hits: RadarHit[] = [];

  for (let i = 0; i < UNIVERSE.length; i++) {
    const sym = UNIVERSE[i];
    process.stdout.write(`[${i+1}/${UNIVERSE.length}] Scanne ${sym.padEnd(8)} `);
    
    try {
      const candles = await fetchDailyCandles(sym);
      const res = testThirdOfThirdCoiling(candles);
      
      if (res.primed) {
        process.stdout.write(`👉 🎯 PRIMED (Zündabstand: ${res.dist?.toFixed(2)}%)\n`);
        hits.push({
          symbol: sym,
          currentPrice: candles[candles.length-1].close,
          subHigh: res.subHigh!,
          distancePct: res.dist!
        });
      } else {
        process.stdout.write(`--\n`);
      }
    } catch (e) {
      process.stdout.write(`❌ API Error\n`);
    }

    // Sanfte Drosselung für Yahoo (100ms)
    await new Promise(r => setTimeout(r, 100));
  }

  console.log("\n========================================================");
  console.log(`🏆 GEFUNDENE "THIRD OF A THIRD" LAUNCHPADS: (${hits.length})`);
  console.log("========================================================\n");

  if (hits.length === 0) {
    console.log("😴 Aktuell notiert keine Aktie des Universums im exakten Zündfenster.");
    console.log("Tipp: Erweitere das Array 'UNIVERSE' oder erhöhe die Toleranz.");
    return;
  }

  // Sortiere nach der schärfsten Lunte (am nächsten an 0.00%)
  hits.sort((a,b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

  hits.forEach(h => {
    const state = h.distancePct < 0 ? "Kurz vor Breakout" : "Frischer Breakout";
    console.log(`🟢 **${h.symbol}** (${state})`);
    console.log(`   - Kurs: ${h.currentPrice.toFixed(2)} USD | Sub-Gipfel: ${h.subHigh.toFixed(2)} USD`);
    console.log(`   - Abstand zur Zündschnur: **${h.distancePct.toFixed(2)}%**`);
    console.log(`   👉 Telegram-Sniper:  /analyse ${h.symbol}\n`);
  });
}

runRadar();

