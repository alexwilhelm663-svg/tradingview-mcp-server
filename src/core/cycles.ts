import type { Candle } from "./marketData";
import { zigzag } from "./zigzag";

export interface CycleLeg {
  dir: 1 | -1;
  from: number; to: number;
  fromDate: string; toDate: string;
  log: number; bars: number; eff: number;
  running: boolean;
}

export interface Cycle {
  motive: CycleLeg;
  corr: CycleLeg | null;
  retr: number | null;
}

export interface CycleRead {
  degree: number;      // gewaehlte ZigZag-Stufe in %
  cycles: Cycle[];
  summary: string;     // eine Zeile fuer den Kurzreport
  lines: string[];     // Zyklusliste fuer die Enthaltungs-Ausgabe
}

const pctOf = (from: number, to: number) => (to / from - 1) * 100;

function buildLegs(c: Candle[], th: number): CycleLeg[] {
  const piv = zigzag(c, th);
  if (piv.length < 2) return [];
  const idxOf = (d: string) => c.findIndex((k) => k.date === d);
  const out: CycleLeg[] = [];
  let a = { p: piv[0].price, d: piv[0].date, i: idxOf(piv[0].date) };
  const add = (p: number, d: string, i: number, running: boolean) => {
    if (i <= a.i) return;
    const seg = c.slice(a.i, i + 1);
    let gross = 0;
    for (let x = 1; x < seg.length; x++) {
      gross += Math.abs(Math.log(seg[x].close) - Math.log(seg[x - 1].close));
    }
    const net = Math.abs(Math.log(p) - Math.log(a.p));
    out.push({
      dir: p > a.p ? 1 : -1, from: a.p, to: p, fromDate: a.d, toDate: d,
      log: net, bars: i - a.i, eff: gross > 0 ? Math.min(1, net / gross) : 0, running,
    });
    a = { p, d, i };
  };
  for (let j = 1; j < piv.length; j++) add(piv[j].price, piv[j].date, idxOf(piv[j].date), false);
  const last = c.length - 1;
  if (last > a.i + 2) add(c[last].close, c[last].date, last, true);
  return out;
}

/**
 * Grad so waehlen, dass 4-12 Beine entstehen. Zu fein und man zaehlt Rauschen,
 * zu grob und der ganze Chart ist ein Bein.
 */
function pickDegree(c: Candle[]): { th: number; legs: CycleLeg[] } | null {
  let best: { th: number; legs: CycleLeg[]; score: number } | null = null;
  for (const th of [60, 50, 40, 33, 27, 22, 18, 15, 12]) {
    const legs = buildLegs(c, th);
    if (legs.length < 3) continue;
    const score =
      legs.length >= 4 && legs.length <= 12
        ? 0
        : Math.min(Math.abs(legs.length - 4), Math.abs(legs.length - 12));
    if (best === null || score < best.score) best = { th, legs, score };
    if (score === 0) break;
  }
  return best ? { th: best.th, legs: best.legs } : null;
}

/**
 * V148: Zyklen-Sicht (Antrieb + Korrektur).
 *
 * Die Fuenferzaehlung braucht EINE regelkonforme 0-5-Sequenz im ganzen
 * Fenster; findet sie keine, schweigt die Engine komplett - auch wenn der
 * Verlauf offensichtlich strukturiert ist (Fall ALAB). Die Zyklen-Sicht
 * segmentiert stattdessen in alternierende Antriebs- und Korrekturphasen
 * und sagt, wo im Rhythmus wir stehen. Sie ersetzt keine Zaehlung und
 * erzeugt keine Setups - sie beantwortet nur die Frage, die sonst offen
 * bleibt.
 */
export function readCycles(candles: Candle[]): CycleRead | null {
  if (candles.length < 30) return null;
  const picked = pickDegree(candles);
  if (!picked) return null;

  const cycles: Cycle[] = [];
  let i = 0;
  while (i < picked.legs.length) {
    const motive = picked.legs[i];
    const next = picked.legs[i + 1];
    const retr = next && motive.log > 0 ? next.log / motive.log : null;
    if (next && retr !== null && retr < 1.0) {
      cycles.push({ motive, corr: next, retr });
      i += 2;
    } else {
      cycles.push({ motive, corr: null, retr: null });
      i += 1;
    }
  }
  if (cycles.length === 0) return null;

  const lines = cycles.map((z, n) => {
    const m = z.motive;
    let s =
      `${n + 1}. Antrieb ${m.dir > 0 ? "↑" : "↓"} ${m.from.toFixed(2)}→${m.to.toFixed(2)} ` +
      `(${pctOf(m.from, m.to) > 0 ? "+" : ""}${pctOf(m.from, m.to).toFixed(0)} %, ${m.bars} K)`;
    if (z.corr) {
      s += ` · Korrektur →${z.corr.to.toFixed(2)} (Retr ${z.retr!.toFixed(2)}, ${z.corr.bars} K)`;
      if (z.corr.running) s += " ← läuft";
    } else if (m.running) s += " ← läuft";
    return s;
  });

  const last = cycles[cycles.length - 1];
  let phase: string;
  if (last.corr && last.corr.running) {
    phase =
      `Korrektur läuft (Retr ${last.retr!.toFixed(2)} seit ${last.motive.to.toFixed(2)}, ` +
      `${last.corr.bars} K)`;
  } else if (last.motive.running) {
    phase =
      `Antrieb ${last.motive.dir > 0 ? "↑" : "↓"} läuft ` +
      `(${pctOf(last.motive.from, last.motive.to) > 0 ? "+" : ""}` +
      `${pctOf(last.motive.from, last.motive.to).toFixed(0)} % seit ${last.motive.from.toFixed(2)}, ${last.motive.bars} K)`;
  } else if (last.corr) {
    phase =
      `letzte Korrektur endete bei ${last.corr.to.toFixed(2)} ` +
      `(Retr ${last.retr!.toFixed(2)}) – neue Bewegung im Aufbau`;
  } else {
    phase = `letzter Antrieb endete bei ${last.motive.to.toFixed(2)} – neue Bewegung im Aufbau`;
  }

  return {
    degree: picked.th,
    cycles,
    summary: `🔄 ${cycles.length} Zyklen (Grad ${picked.th} %) · ${phase}`,
    lines,
  };
}
