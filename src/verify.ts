/**
 * V152: Regressionspruefung der Referenzzaehlungen.
 *
 * Verglichen werden TREND und WELLENPUNKTE, nicht die ZigZag-Stufe. Die Stufe
 * ist bei Punktgleichstand im Score willkuerlich: NET erreicht auf allen vier
 * Stufen (25/18/12/8 %) Score 11 mit praktisch identischer Zaehlung - nur
 * Welle 4 unterscheidet sich um einen Dollar. Eine gepinnte Stufe schlug
 * dadurch Alarm, obwohl sich an der Zaehlung nichts geaendert hatte.
 *
 * Aufruf:  npm run verify
 *          npm run verify -- --update   (Baseline neu schreiben)
 */
import fs from "fs";
import path from "path";
import { fetchMarketData } from "./core/marketData";
import { findImpulseAdaptive } from "./core/impulseFinder";
import { checkProportion } from "./core/proportion";

const TOL = 0.005; // 0,5 % Preistoleranz je Wellenpunkt
const FILE = path.join(process.cwd(), "knowledge", "reference", "counts.json");

interface Entry { trend: string; score_info: number; punkte: number[] }
interface Doc { _hinweis: string; _aktualisiert: string; titel: Record<string, Entry> }

async function main() {
  const update = process.argv.includes("--update");
  const doc: Doc = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  let fail = 0;
  let drift = 0;

  for (const [sym, ref] of Object.entries(doc.titel)) {
    const { weeklyAnalysisCandles: candles } = await fetchMarketData(sym);
    const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
    if (!outcome.impulse) {
      console.log(`❌ ${sym.padEnd(9)} Enthaltung (Referenz: ${ref.trend}, ${ref.punkte.length} Punkte)`);
      fail++;
      continue;
    }
    const res = outcome.impulse.result;
    const pts = res.count.points.map((p) => Number(p.price.toFixed(2)));

    if (update) {
      doc.titel[sym] = { trend: res.count.trend, score_info: res.score, punkte: pts };
      console.log(`↻  ${sym.padEnd(9)} aktualisiert: ${res.count.trend} S${res.score} ${pts.join("/")}`);
      continue;
    }

    const trendOk = res.count.trend === ref.trend;
    const countOk = pts.length === ref.punkte.length;
    const ptsOk =
      countOk &&
      pts.every((p, i) => {
        const r = ref.punkte[i];
        return r > 0 ? Math.abs(p - r) / r <= TOL : p === r;
      });

    if (trendOk && ptsOk) {
      const scoreNote = res.score !== ref.score_info ? ` (Score ${ref.score_info}→${res.score}, informativ)` : "";
      console.log(`✓  ${sym.padEnd(9)} unverändert${scoreNote}`);
      if (scoreNote) drift++;
    } else {
      fail++;
      console.log(`❌ ${sym.padEnd(9)} ABWEICHUNG`);
      if (!trendOk) console.log(`      Trend: ${ref.trend} → ${res.count.trend}`);
      if (!ptsOk) {
        console.log(`      Referenz: ${ref.punkte.join("/")}`);
        console.log(`      Aktuell : ${pts.join("/")}`);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (update) {
    doc._aktualisiert = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 1));
    console.log("\nBaseline geschrieben.");
    return;
  }
  console.log(
    `\n${fail === 0 ? "✅ Alle Referenzen intakt" : `❌ ${fail} Abweichung(en)`}` +
    (drift > 0 ? ` · ${drift}× Score-Drift (unkritisch)` : "")
  );
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Fehler:", e?.message ?? e);
  process.exitCode = 1;
});
