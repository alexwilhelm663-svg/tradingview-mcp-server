/**
 * V162: `npm run report SYMBOL [range] [interval]`
 *
 * Gibt den kompletten Report als Text aus - dieselbe Zusammensetzung, die der
 * Bot verschickt. Damit laesst sich eine Aenderung pruefen, ohne auf einen
 * Screenshot aus dem Telegram zu warten.
 */
import { buildReport, joinReport } from "./core/reportText";

async function main() {
  const [symbol, range = "5y", interval = "1wk"] = process.argv.slice(2);
  if (!symbol) {
    console.error("Nutzung: npm run report -- SYMBOL [5y|max|1y] [1wk|1d]");
    process.exitCode = 1;
    return;
  }
  const parts = await buildReport(symbol.toUpperCase(), range, interval, true);
  console.log("─".repeat(72));
  console.log(joinReport(parts));
  console.log("─".repeat(72));
  console.log(`Chart: ${parts.hasChart ? "ja" : "nein"}`);
}

main().catch((e) => {
  console.error("Fehler:", e?.message ?? e);
  process.exitCode = 1;
});
