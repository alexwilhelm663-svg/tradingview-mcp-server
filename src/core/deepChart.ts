import { spawn } from "child_process";
import path from "path";
import db from "./db";
import { fetchMarketData, type Candle, isThinHistory } from "./marketData";
import {
  findImpulseAdaptive,
  findRankedImpulses,
  type AdaptiveImpulse,
  type WaveCount,
} from "./impulseFinder";
import { checkProportion } from "./proportion";
import type { FibCluster } from "./fibCluster";
import { assessMultiWave } from "./multiWave";
import { measureContinuity } from "./continuity";
import { readDegree } from "./degree";
import { zigzag } from "./zigzag";
import { assessQuality } from "./quality";
import {
  forecastTarget,
  inspectForecastSetup,
  type Direction,
} from "./forecast";
import {
  selectDeepDecision,
  type DeepStatus,
  type PersistedDecision,
} from "./deepDecision";

/**
 * V171: `/deep` ist ein Decision Board, keine zweite Forecast-Engine.
 *
 * Alle handelbaren Level kommen entweder aus dem unveraenderlichen Snapshot
 * eines laufenden Setups oder aus `inspectForecastSetup`, das exakt denselben
 * kanonischen Pfad wie Live und Replay benutzt. Es gibt keine frei erfundenen
 * Szenario-Punkte und keine handelbaren Score-1-Fallback-Zonen.
 */

export interface DeepResult {
  buffer: Buffer | null;
  caption: string;
}

const pt = (wc: WaveCount, label: string) =>
  wc.points.find((p) => p.label === label) ?? null;

function parseStringArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Nur ein noch laufender, zum angeforderten Rahmen passender Snapshot gewinnt. */
function loadPersistedDecision(
  symbol: string,
  interval: string,
  range: string
): PersistedDecision | null {
  const row = db.prepare(
    `SELECT s.status, s.direction, s.cluster_floor, s.cluster_ceiling,
            s.cluster_score, s.trigger_level, s.invalidation, s.c_low,
            s.snapshot_id, s.as_of, s.data_hash, s.engine_version,
            s.created_at, s.levels,
            ss.cluster_evidence_count, ss.cluster_families,
            t.entry_price, t.target
       FROM setups s
       LEFT JOIN signal_snapshots ss ON ss.id = s.snapshot_id
       LEFT JOIN trade_history t
         ON t.snapshot_id = s.snapshot_id
        AND t.resolution IS NULL
        AND t.is_success IS NULL
      WHERE UPPER(s.symbol) = UPPER(?)
        AND COALESCE(s.interval_name, ?) = ?
        AND COALESCE(s.range_name, ?) = ?
        AND s.status IN ('PENDING', 'CONFIRMED')
      ORDER BY CASE s.status WHEN 'PENDING' THEN 0 ELSE 1 END,
               s.updated_at DESC
      LIMIT 1`
  ).get(symbol, interval, interval, range, range) as any;

  if (!row) return null;
  if (row.status === "CONFIRMED" && row.entry_price == null) return null;
  const direction: Direction = row.direction === "SHORT" ? "SHORT" : "LONG";
  const zone: FibCluster = {
    floor: Number(row.cluster_floor),
    ceiling: Number(row.cluster_ceiling),
    center: (Number(row.cluster_floor) + Number(row.cluster_ceiling)) / 2,
    score: Number(row.cluster_score),
    evidenceCount: Number(row.cluster_evidence_count ?? parseStringArray(row.levels).length),
    labels: parseStringArray(row.levels),
    families: parseStringArray(row.cluster_families),
  };
  const trigger = Number(row.trigger_level);
  const cExtreme = Number(row.c_low);
  const target = row.target != null
    ? Number(row.target)
    : forecastTarget({ direction, trigger, cExtreme });
  return {
    status: row.status === "CONFIRMED" ? "CONFIRMED" : "PENDING",
    direction,
    zone,
    trigger,
    invalidation: Number(row.invalidation),
    cExtreme,
    target,
    entry: row.entry_price == null ? null : Number(row.entry_price),
    snapshotId: String(row.snapshot_id ?? "legacy"),
    asOf: String(row.as_of ?? row.created_at),
    dataHash: String(row.data_hash ?? "legacy-no-data-hash"),
    engineVersion: String(row.engine_version ?? "legacy"),
    createdAt: String(row.created_at),
  };
}

interface CountStability {
  agreeing: number;
  total: number;
}

function countStability(candles: Candle[], adaptive: AdaptiveImpulse): CountStability {
  const chosen0 = pt(adaptive.result.count, "0");
  const chosen5 = pt(adaptive.result.count, "5");
  const ranked = findRankedImpulses(adaptive.pivots, 5)
    .filter((r) => checkProportion(candles, r.count).ok);
  if (!chosen0 || !chosen5 || ranked.length === 0) return { agreeing: 1, total: 1 };
  const agreeing = ranked.filter((r) => {
    const a0 = pt(r.count, "0");
    const a5 = pt(r.count, "5");
    return r.count.trend === adaptive.result.count.trend &&
      a0?.date === chosen0.date && a5?.date === chosen5.date;
  }).length;
  return { agreeing: Math.max(1, agreeing), total: ranked.length };
}

function sameZone(a: FibCluster | null, b: FibCluster): boolean {
  if (!a) return false;
  const scale = Math.max(Math.abs(a.center), Math.abs(b.center), 1);
  return Math.abs(a.center - b.center) / scale < 0.001;
}

function lastMatching<T>(items: T[], predicate: (item: T) => boolean): T | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) return items[i];
  }
  return null;
}

function renderDeep(payload: unknown): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "python_service", "deep_drawer.py");
    const py = spawn("python3", [script], {
      env: {
        ...process.env,
        MPLCONFIGDIR: process.env.MPLCONFIGDIR ?? "/tmp/ew-matplotlib-cache",
      },
    });
    const chunks: Buffer[] = [];
    py.stdout.on("data", (d) => chunks.push(d));
    py.stderr.on("data", (d) => console.error("[DEEP]", d.toString().slice(0, 500)));
    py.on("close", (code) => resolve(code === 0 && chunks.length ? Buffer.concat(chunks) : null));
    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}

function statusText(status: DeepStatus): string {
  const labels: Record<DeepStatus, string> = {
    PENDING: "PENDING · LEVEL EINGEFROREN",
    CONFIRMED: "CONFIRMED · TRADE AKTIV",
    CANDIDATE: "KANONISCHER KANDIDAT",
    WATCH: "WATCH · ZU WENIG FAMILIEN",
    WAIT_C: "WARTET AUF C-EXTREM",
    OUTSIDE_WINDOW: "AUSSERHALB ZEITFENSTER",
    IMPULSE_ACTIVE: "IMPULS NOCH AKTIV",
    NO_SETUP: "KEIN AKTIVES SETUP",
  };
  return labels[status];
}

export async function buildDeepChart(
  symbol: string,
  range = "5y",
  interval = "1wk"
): Promise<DeepResult> {
  let candles: Candle[];
  let provenance: Awaited<ReturnType<typeof fetchMarketData>>["provenance"];
  try {
    const market = await fetchMarketData(symbol, interval, range);
    candles = market.weeklyAnalysisCandles;
    provenance = market.provenance;
  } catch (e: any) {
    if (isThinHistory(e)) {
      return {
        buffer: null,
        caption: `⚠️ **${symbol}**: ${e.have} von ${e.need} abgeschlossenen Kerzen (Erstnotiz ${e.firstTrade ?? "?"}).`,
      };
    }
    return { buffer: null, caption: `❌ ${symbol}: ${e?.message ?? e}` };
  }

  const outcome = findImpulseAdaptive(candles, (r) => checkProportion(candles, r.count).ok);
  if (!outcome.impulse) {
    return { buffer: null, caption: `🔍 **${symbol}**: keine belastbare Zählung (DK-7).` };
  }
  const adaptive = outcome.impulse;
  const result = adaptive.result;
  const wc = result.count;
  const inspection = inspectForecastSetup(candles, {
    minClusterScore: 3,
    interval,
    range,
    impulse: adaptive,
  });
  if (!inspection) {
    return { buffer: null, caption: `🔍 **${symbol}**: Forecast-Kontext nicht ableitbar.` };
  }

  const persisted = loadPersistedDecision(symbol, interval, range);
  const decision = selectDeepDecision(inspection, persisted);
  const w4 = pt(wc, "4");
  const w5 = pt(wc, "5");
  const directionSign: 1 | -1 = wc.trend === "bullish" ? 1 : -1;

  const currentPivots = zigzag(candles, adaptive.threshold, true);
  const provisional = lastMatching(currentPivots, (p) => p.status === "PROVISIONAL");
  const lastConfirmed = lastMatching(adaptive.pivots, (p) => p.status === "CONFIRMED");
  const multiWave = w5
    ? assessMultiWave(candles, w5.date, w5.price, (directionSign * -1) as 1 | -1, adaptive.threshold)
    : null;
  const continuity = measureContinuity(adaptive.pivots, wc);
  const continuityGrade = !continuity ? "n/a"
    : continuity.ratio <= 0.25 ? "hoch"
    : continuity.ratio <= 0.6 ? "mittel"
    : "niedrig";
  const quality = assessQuality(candles, wc, adaptive.threshold);
  const stability = countStability(candles, adaptive);
  const degree = readDegree(candles, inspection.price);

  const clusters = inspection.clusters
    .filter((c) => c.score >= 2)
    .slice()
    .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount)
    .slice(0, 6)
    .map((c) => ({
      floor: c.floor,
      ceiling: c.ceiling,
      center: c.center,
      score: c.score,
      evidenceCount: c.evidenceCount,
      labels: c.labels,
      families: c.families,
      role: sameZone(decision.zone, c) ? "ACTIVE" : c.score >= 3 ? "STRONG" : "WATCH",
    }));
  if (decision.zone && !clusters.some((c) => sameZone(decision.zone, c))) {
    clusters.unshift({
      floor: decision.zone.floor,
      ceiling: decision.zone.ceiling,
      center: decision.zone.center,
      score: decision.zone.score,
      evidenceCount: decision.zone.evidenceCount,
      labels: decision.zone.labels,
      families: decision.zone.families,
      role: "ACTIVE",
    });
  }

  const marks: { price: number; label: string; color: string; style: string }[] = [];
  if (decision.trigger != null) {
    marks.push({ price: decision.trigger, label: "TRIGGER · SCHLUSSKURS", color: "#22c55e", style: "solid" });
  }
  if (decision.invalidation != null) {
    marks.push({ price: decision.invalidation, label: "INVALIDIERUNG · SCHLUSSKURS", color: "#ef4444", style: "solid" });
  }
  if (decision.target != null) {
    marks.push({ price: decision.target, label: "MODELLZIEL 1.618·i", color: "#38bdf8", style: "dash" });
  }
  marks.push({ price: inspection.price, label: "LETZTER SCHLUSS", color: "#e2e8f0", style: "dot" });

  const relation = decision.direction === "LONG" ? ">" : "<";
  const invRelation = decision.direction === "LONG" ? "<" : ">";
  const rules: { name: string; condition: string; result: string; color: string }[] = [];
  if (decision.status === "CONFIRMED" && decision.target != null && decision.invalidation != null) {
    rules.push({
      name: "PRIMÄR",
      condition: `Trade aktiv${decision.entry != null ? ` ab ${decision.entry.toFixed(2)}` : ""}`,
      result: `Ziel ${decision.target.toFixed(2)}`,
      color: "#22c55e",
    });
    rules.push({
      name: "RISIKO",
      condition: `${invRelation} ${decision.invalidation.toFixed(2)}`,
      result: "Trade invalidiert",
      color: "#ef4444",
    });
  } else if (
    (decision.status === "PENDING" || decision.status === "CANDIDATE") &&
    decision.trigger != null && decision.invalidation != null && decision.target != null
  ) {
    rules.push({
      name: "PRIMÄR",
      condition: `Schluss ${relation} ${decision.trigger.toFixed(2)}`,
      result: `Ziel ${decision.target.toFixed(2)}`,
      color: "#22c55e",
    });
    rules.push({
      name: "ALTERNATIVE",
      condition: `Schluss ${invRelation} ${decision.invalidation.toFixed(2)}`,
      result: "These invalidiert",
      color: "#f97316",
    });
  } else {
    rules.push({
      name: "AKTION",
      condition: "Kein bestätigter Trigger",
      result: "NO TRADE",
      color: "#94a3b8",
    });
  }

  const w4Index = w4 ? candles.findIndex((c) => c.date === w4.date) : -1;
  const desiredZoom = w4Index >= 0 ? Math.max(0, w4Index - 3) : candles.length - 78;
  // Mindestens 52, hoechstens 78 Bars: W4 bleibt im Makro sichtbar, waehrend
  // der operative Chart wirklich auf das aktuelle Setup fokussiert.
  const zoomIndex = Math.max(
    0,
    candles.length - 78,
    Math.min(desiredZoom, candles.length - 52)
  );
  const corr = inspection.correction;
  const payload = {
    version: "V171",
    symbol,
    interval: interval === "1d" ? "DAILY" : interval === "1wk" ? "WEEKLY" : interval.toUpperCase(),
    range,
    price: inspection.price,
    trend: wc.trend,
    candles,
    zoomFrom: candles[zoomIndex]?.date ?? candles[0].date,
    waves: wc.points.map((p) => ({ ...p, status: "CONFIRMED" })),
    correction: corr?.legPoints ?? [],
    provisional: provisional ? {
      date: provisional.date,
      price: provisional.price,
      kind: provisional.kind,
      label: provisional.kind === "H" ? "? Hoch" : "? Tief",
    } : null,
    multiWave: multiWave?.intact ? multiWave.points : [],
    clusters,
    marks,
    rules,
    decision: {
      ...decision,
      statusLabel: statusText(decision.status),
      zone: decision.zone ? {
        floor: decision.zone.floor,
        ceiling: decision.zone.ceiling,
        score: decision.zone.score,
        evidenceCount: decision.zone.evidenceCount,
        families: decision.zone.families,
      } : null,
    },
    evidence: {
      countScore: `${result.score}/${result.maxScore}`,
      countStability: `${stability.agreeing}/${stability.total} gleicher W0/W5-Anker`,
      continuity: continuity
        ? `${continuityGrade} · ${(continuity.ratio * 100).toFixed(0)} % Pivot-Lücken`
        : "n/a",
      quality: `${quality.bonus}/${quality.maxBonus || 0}`,
      qualityFlags: quality.flags,
      threshold: `${adaptive.threshold} %`,
      degree: degree?.cycleGrade ?? "n/a",
      lastConfirmedPivot: lastConfirmed?.confirmedAt ?? lastConfirmed?.date ?? null,
      correctionPattern: corr?.pattern ?? null,
      reversalRisk: corr?.reversalRisk ?? "NONE",
      timeStatus: inspection.timeStatus,
      timeWindow: inspection.timeWindow,
    },
    provenance: {
      provider: provenance.provider,
      adjustment: provenance.adjustment,
      fetchedAt: provenance.fetchedAt,
      dataAsOf: provenance.lastBarClose ?? inspection.asOf,
      dataHash: inspection.dataHash,
      corporateActionCount: provenance.corporateActionCount,
      closedBarsOnly: candles.every((c) => c.isClosed !== false),
    },
  };

  const buffer = await renderDeep(payload);
  const levelLine = decision.trigger != null && decision.invalidation != null
    ? `\nTrigger ${relation} ${decision.trigger.toFixed(2)} · Invalidierung ${invRelation} ${decision.invalidation.toFixed(2)}`
    : "";
  const caption =
    `📐 **${symbol}** · ${payload.interval} · ${statusText(decision.status)}` +
    `\nDatenstand ${String(payload.provenance.dataAsOf).slice(0, 10)} · ${decision.direction}` +
    levelLine;
  return { buffer, caption };
}
