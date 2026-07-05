// @ts-nocheck
import { spawn } from "child_process";

console.log("⚡ ========================================================");
console.log("⚡ THE QUANT RADAR: Hunting the 'Third of a Third' (v1.1)");
console.log("⚡ ========================================================");

// Das hochexplosive Ticker-Universum (Jederzeit erweiterbar)
const UNIVERSE = [
  // AI & US Tech Prime Momentum
  "NVDA", "TSLA", "PLTR", "AMD", "ARM", "SMCI", "APP", "DDOG", "CRWD", "PANW", 
  // Crypto Proxies & High-Beta Outperformers
  "MSTR", "COIN", "HOOD", "MARA", "CLSK", "RIVN", "SHOP", "SE", "UBER", "CELH",
  // S&P 500 Heavyweights & High-Relative-Strength
  "AMZN", "META", "GOOGL", "AAPL", "NFLX", "AVGO", "QCOM", "NOW", "INTU", "GE",
  // German High-Beta, Short-Squeeze & Volatility Candidates
  "SAP", "P911.DE", "RHM.DE", "ZAL.DE", "IFX.DE", "ENR.DE", "AIXA.DE", "EVT.DE"
];

interface RadarHit { 
  symbol: string; 
  currentPrice: number; 
  subHigh: number; 
  distancePct: number; 
}

// Lädt den hochpräzisen Tages-Chart der letzten 250 Handelstage (~1 Jahr)
async function fetchDailyCandles(symbol: string): Promise<any[]> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } });
  if (!res.ok) return [];
  
  const raw = await res.json();
  const timestamps = raw.chart?.result?.[0]?.timestamp || [];
  const quote = raw.chart?.result?.[0]?.indicators?.quote?.[0] || {};
  
  const candles: any[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close[i] == null || quote.high[i] == null || quote.low[i] == null) continue;
    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      high: parseFloat(quote.high[i]),
      low: parseFloat(quote.low[i]),
      close: parseFloat(quote.close[i])
    });
  }
  return candles;
}

// DER MATHEMATISCHE KASKADEN-FILTER (Die Gespannte-Feder-Lunte)
function testThirdOfThirdCoiling(candles: any[]): { primed: boolean; subHigh?: number; dist?: number } {
  if (candles.length < 100) return { primed: false };

  // 1. MAKRO-EBENE: Suche den Ursprung (Welle 0 / L0) in der ersten Hälfte des Datensatzes
  const firstHalf = candles.slice(0, Math.floor(candles.length * 0.6));
  let l0 = firstHalf[0];
  for (const c of firstHalf) if (c.low < l0.low) l0 = c;

  const postL0 = candles.slice(candles.indexOf(l0));
  if (postL0.length < 50) return { primed: false };

  // Makro-Gipfel (Welle 1 / H1)
  let h1 = postL0[0];
  for (const c of postL0) if (c.high > h1.high) h1 = c;

  const postH1 = postL0.slice(postL0.indexOf(h1));
  if (postH1.length < 20) return { primed: false };

  // Makro-Tal (Welle 2 / L2)
  let l2 = postH1[0];
  for (const c of postH1) if (c.low < l2.low) l2 = c;

  // PRÜFUNG 1: Liegt ein mathematisch gesundes Makro-Retracement vor?
  if (l2.low <= l0.low) return { primed: false }; // 100% Retracement Bruch verhindert
  
  const wave1Height = h1.high - l0.low;
  const retracementDrop = h1.high - l2.low;
  const retracementRatio = retracementDrop / wave1Height;
  
  // Gültiges Fibonacci-Retracement-Band (35% bis 82% Korrekturtiefe)
  if (retracementRatio < 0.35 || retracementRatio > 0.82) return { primed: false };

  // 2. DAS INNERE FRAKTAL: Die Lunte wird nach dem Makro-Tal L2 gedreht
  const launchpad = postH1.slice(postH1.indexOf(l2) + 1);
  if (launchpad.length < 10) return { primed: false };

  // Innerer Mikro-Gipfel (Sub-Welle 1)
  let subH1 = launchpad[0];
  for (const c of launchpad) if (c.high > subH1.high) subH1 = c;

  // Der Sub-Gipfel DARF das große Makro-Top H1 noch nicht durchbrochen haben!
  if (subH1.high >= h1.high) return { primed: false };

  // Inneres Mikro-Tal (Sub-Welle 2) -> Muss strikt über dem Makro-Tal L2 liegen
  const postSubH1 = launchpad.slice(launchpad.indexOf(subH1) + 1);
  if (postSubH1.length < 3) return { primed: false };

  let subL2 = postSubH1[0];
  for (const c of postSubH1) if (c.low < subL2.low) subL2 = c;

  if (subL2.low <= l2.low) return { primed: false };

  // 3. DER ZÜND-ABSTAND: Sitzt der aktuelle Kurs exakt auf der Kante von Sub-Welle 1?
  const lastClose = candles[candles.length - 1].close;
  const distFromIgnition = (lastClose - subH1.high) / subH1.high;

  // ZÜNDFENSTER: Maximal 3.5% unter dem Ausbruchsdeckel, maximal 1.5% bereits ausgebrochen
  if (distFromIgnition >= -0.035 && distFromIgnition <= 0.015) {
    return { primed: true, subHigh: subH1.high, dist: distFromIgnition * 100 };
  }

  return { primed: false };
}

// TELEGRAM PUSH ENGINE: Schießt die Treffer direkt auf dein Smartphone
async function pushToTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("⚠️ Telegram-Push übersprungen: TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlen in den Env-Variablen.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
    if (res.ok) console.log("📲 Telegram-Push-Benachrichtigung erfolgreich gesendet!");
  } catch (e) {
    console.error("❌ Telegram-Push fehlgeschlagen:", e);
  }
}

// MAIN RUNNER
async function runRadar() {
  const hits: RadarHit[] = [];

  for (let i = 0; i < UNIVERSE.length; i++) {
    const sym = UNIVERSE[i];
    process.stdout.write(`[${i+1}/${UNIVERSE.length}] Scanne ${sym.padEnd(8)} `);
    
    try {
      const candles = await fetchDailyCandles(sym);
      const res = testThirdOfThirdCoiling(candles);
      
      if (res.primed) {
        process.stdout.write(`👉 🎯 PRIMED (Abstand: ${res.dist?.toFixed(2)}%)\n`);
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

    // Höfliche 100ms Drosselung, damit uns die Yahoo-API nicht drosselt
    await new Promise(r => setTimeout(r, 100));
  }

  console.log("\n========================================================");
  console.log(`🏆 SEARCH COMPLETE. FOUND LAUNCHPADS: (${hits.length})`);
  console.log("========================================================\n");

  if (hits.length === 0) {
    console.log("😴 Aktuell notiert keine Aktie des Universums im exakten Zündfenster.");
    return;
  }

  // Sortierung: Die schärfsten Lunten (nächste Distanz zur Ausbruchsmarke) zuerst
  hits.sort((a,b) => Math.abs(a.distancePct) - Math.abs(b.distancePct));

  // Aufbau der klickbaren Telegram-Nachricht
  let msg = `⚡️ **QUANT RADAR REPORT** ⚡️\n_Hunting Third-of-a-Third Base-Coils_\n\n`;
  
  hits.forEach(h => {
    const icon = h.distancePct < 0 ? "⏳" : "🔥";
    const statusText = h.distancePct < 0 ? "Kurz vor Breakout" : "Frischer Breakout";
    
    msg += `**${h.symbol}** ${icon} _${statusText}_\n`;
    msg += `├ Kurs: \`${h.currentPrice.toFixed(2)} USD\`\n`;
    msg += `├ Trigger-Kante: \`${h.subHigh.toFixed(2)} USD\`\n`;
    msg += `├ Abstand zur Lunte: **${h.distancePct.toFixed(2)}%**\n`;
    msg += `└ Sniper-Befehl: \`/analyse ${h.symbol}\`\n\n`;
  });

  console.log(msg);
  
  // Absenden an dein Handy
  await pushToTelegram(msg);
}

runRadar();
