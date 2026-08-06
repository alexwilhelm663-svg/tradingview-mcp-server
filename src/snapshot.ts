/**
 * V162: Struktur-Snapshots der Referenztitel.
 *
 * `npm run verify` prueft die WELLENPUNKTE. Das faengt Zaehlungsfehler, aber
 * nicht, wenn ein ganzer Report-Baustein verstummt: Nach der Verschaerfung in
 * v5.x fand die Multi-1-2-Erkennung ueber 20 Titel null Treffer, ohne dass
 * eine Referenz angeschlagen haette - aufgefallen ist es erst durch Nachfrage.
 *
 * Der Snapshot speichert daher einen STRUKTURELLEN Fingerabdruck: welche
 * Bausteine erscheinen, nicht welche Kurse darin stehen. Kursbewegungen
 * brechen ihn nicht, ein verstummtes Feature sofort.
 *
 * `npm run snapshot`            vergleichen (Exit 1 bei Abweichung)
 * `npm run snapshot -- --update` Baseline neu schreiben
 */
import fs from "fs";
import path from "path";
import { buildReport, joinReport } from "./core/reportText";

const FILE = path.join(process.cwd(), "knowledge", "reference", "snapshots.json");

interface Target { symbol: string; range: string; interval: string }
const TARGETS: Target[] = [
  { symbol: "MSTR", range: "5y", interval: "1wk" },
  { symbol: "BTC-USD", range: "5y", interval: "1wk" },
  { symbol: "SAP", range: "5y", interval: "1wk" },
  { symbol: "PYPL", range: "5y", interval: "1wk" },
  { symbol: "NVO", range: "5y", interval: "1wk" },   // Multi-1-2 auf Tagesebene
  { symbol: "BILL", range: "5y", interval: "1wk" },  // Verschachtelung
  { symbol: "ALAB", range: "5y", interval: "1wk" },  // Enthaltungsfall
  { symbol: "CRCL", range: "1y", interval: "1d" },   // Tagesmodus
];

type Fingerprint = Record<string, string | number | boolean>;

/** Strukturelle Marker - bewusst ohne Kurse, damit Bewegung sie nicht bricht. */
function fingerprint(text: string, trend: string | null, points: number): Fingerprint {
  const has = (re: RegExp) => re.test(text);
  const grab = (re: RegExp, fallback = "-") => (text.match(re)?.[1] ?? fallback).trim();
  return {
    enthaltung: has(/Enthaltung|Keine belastbare Zählung/),
    trend: trend ?? "-",
    wellenpunkte: points,
    lesart: grab(/Korrektur-Lesart:\s*([A-Za-zÄÖÜäöü\- ]+?)(?:\s*\(|·|$)/m),
    multiWave: has(/Multi-1-2|× 1-2|1-2-Marke/),
    kontinuitaet: grab(/Kontinuität:\s*([^\s(]+)/),
    grad: has(/📐 Grad:/),
    raster: has(/Korrektur-Raster/),
    einstiegsraster: has(/Einstiegsraster/),
    konfluenz: has(/Konfluenz/),
    kaskade: has(/🔎 Kaskade/),
    zyklen: has(/🔄 \d+ Zyklen/),
    setup: has(/Trigger|Watch-Zone|Kaufzone|Widerstandszone/),
    umschlag: has(/A oder 1\?|Umschlag|Trendwechsel/),
  };
}

async function main() {
  const update = process.argv.includes("--update");
  const prev: Record<string, Fingerprint> = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, "utf-8")).titel ?? {}
    : {};
  const now: Record<string, Fingerprint> = {};
  let fail = 0;

  for (const t of TARGETS) {
    const key = `${t.symbol} ${t.interval}/${t.range}`;
    let fp: Fingerprint;
    try {
      const parts = await buildReport(t.symbol, t.range, t.interval, true);
      const r: any = parts;
      const text = joinReport(parts);
      const trend = /Makro-Trend `(\w+)`/.exec(parts.caption)?.[1] ?? null;
      const points = (text.match(/W[0-5] /g) ?? []).length;
      fp = fingerprint(text, trend, points);
      void r;
    } catch (e: any) {
      fp = { fehler: String(e?.message ?? e) };
    }
    now[key] = fp;

    if (update) {
      console.log(`↻  ${key}`);
      continue;
    }
    const old = prev[key];
    if (!old) {
      console.log(`•  ${key.padEnd(22)} neu (keine Baseline)`);
      continue;
    }
    const diffs = Object.keys({ ...old, ...fp }).filter(
      (k) => String(old[k]) !== String(fp[k])
    );
    if (diffs.length === 0) {
      console.log(`✓  ${key.padEnd(22)} unverändert`);
    } else {
      fail++;
      console.log(`❌ ${key.padEnd(22)} ${diffs.length} Abweichung(en)`);
      for (const d of diffs) console.log(`      ${d}: ${old[d]} → ${fp[d]}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (update) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(
      FILE,
      JSON.stringify(
        { _hinweis: "V162: struktureller Fingerabdruck der Reports - Marker, keine Kurse.",
          _aktualisiert: new Date().toISOString().slice(0, 10), titel: now },
        null, 1
      )
    );
    console.log("\nBaseline geschrieben.");
    return;
  }
  console.log(`\n${fail === 0 ? "✅ Alle Report-Strukturen unverändert" : `❌ ${fail} Abweichung(en)`}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Fehler:", e?.message ?? e);
  process.exitCode = 1;
});
