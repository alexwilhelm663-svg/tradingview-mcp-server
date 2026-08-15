import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { FibCluster } from "./fibCluster";
import type { ForecastDetection, ForecastInspection } from "./forecast";
import { forecastInvalidation, forecastTarget } from "./forecast";
import { selectDeepDecision } from "./deepDecision";

const cluster: FibCluster = {
  floor: 95,
  ceiling: 101,
  center: 98,
  score: 3,
  evidenceCount: 7,
  labels: ["Retr 0.618", "W4-Zone", "C=1.0·A"],
  families: ["IMPULSE_RETRACEMENT", "PRIOR_WAVE", "ABC_PROJECTION"],
};

const setup: ForecastDetection = {
  direction: "LONG",
  cluster,
  trigger: 105,
  cExtreme: 97,
  timeStatus: "IN_WINDOW",
  timeWindow: { from: "2026-01-01", to: "2026-03-01" },
  asOf: "2026-02-01T00:00:00.000Z",
  dataHash: "abc",
  interval: "1wk",
  range: "5y",
  count: { trend: "bullish", points: [], analysis: "fixture" },
  threshold: 18,
  engineVersion: "171.0.0",
  provider: "yahoo-chart",
  adjustment: "RAW_PROVIDER_OHLC",
};

const inspection: ForecastInspection = {
  direction: "LONG",
  price: 100,
  phase: "CORRECTION",
  gate: "SETUP",
  minClusterScore: 3,
  candidates: [],
  clusters: [cluster],
  watchCluster: cluster,
  setup,
  candidateTrigger: 105,
  cExtreme: 97,
  correction: null,
  timeStatus: "IN_WINDOW",
  timeWindow: setup.timeWindow,
  asOf: setup.asOf,
  dataHash: setup.dataHash,
  interval: setup.interval,
  range: setup.range,
  count: setup.count,
  threshold: setup.threshold,
  engineVersion: setup.engineVersion,
  provider: setup.provider,
  adjustment: setup.adjustment,
};

// Der aktuelle Kandidat benutzt ausschliesslich kanonische Level/Formeln.
const candidate = selectDeepDecision(inspection, null);
assert.equal(candidate.status, "CANDIDATE");
assert.equal(candidate.invalidation, forecastInvalidation(setup));
assert.equal(candidate.target, forecastTarget(setup));
assert.equal(candidate.target, 105 + 1.618 * (105 - 97));

// Ein Frozen Snapshot hat Vorrang; aktuelle Neuberechnung darf ihn nicht bewegen.
const frozen = selectDeepDecision(inspection, {
  status: "PENDING",
  direction: "LONG",
  zone: { ...cluster, floor: 90, ceiling: 96, center: 93 },
  trigger: 102,
  invalidation: 87.3,
  cExtreme: 91,
  target: 119.798,
  entry: null,
  snapshotId: "frozen-snapshot",
  asOf: "2026-01-01T00:00:00.000Z",
  dataHash: "frozen-hash",
  engineVersion: "170.0.0",
  createdAt: "2026-01-01T00:00:00.000Z",
});
assert.equal(frozen.frozen, true);
assert.equal(frozen.trigger, 102);
assert.equal(frozen.invalidation, 87.3);
assert.equal(frozen.target, 119.798);
assert.equal(frozen.dataHash, "frozen-hash");

// Score-2 bleibt WATCH und bekommt weder Trigger noch Ziel als Handelssignal.
const weak: ForecastInspection = {
  ...inspection,
  gate: "WATCH",
  setup: null,
  watchCluster: { ...cluster, score: 2 },
};
const watch = selectDeepDecision(weak, null);
assert.equal(watch.status, "WATCH");
assert.equal(watch.trigger, null);
assert.equal(watch.target, null);
assert.equal(watch.invalidation, null);

// Die alten frei erfundenen Szenario-Multiplikatoren duerfen nicht zurueckkehren.
const source = fs.readFileSync(path.join(process.cwd(), "src", "core", "deepChart.ts"), "utf8");
assert.doesNotMatch(source, /t1\s*\*\s*1\.12|t1\s*\*\s*0\.9|a1\s*\*\s*0\.88/);
assert.doesNotMatch(source, /schematischer Ruecksetzer|buildScenarios|buildTrades/);

console.log("✅ V171 Deep-Decision-Board-Regressionsprüfung bestanden");
