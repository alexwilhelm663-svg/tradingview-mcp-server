import assert from "node:assert/strict";
import type { Candle } from "./marketData";
import { parseYahooCandles } from "./marketData";
import { zigzag } from "./zigzag";
import { clusterLevels } from "./fibCluster";
import { evaluatePendingBar, evaluateTradeBar, type FrozenSetup, type FrozenTrade } from "./lifecycle";

const t0 = 1_700_000_000;
const yahoo = {
  timestamp: [t0, t0 + 3600, t0 + 7200],
  indicators: {
    quote: [{
      open: [100, 101, 102],
      high: [102, 103, 104],
      low: [99, 100, 101],
      close: [101, 102, 103],
      volume: [10, 11, 12],
    }],
  },
  events: { splits: { a: { date: t0 } } },
};

// Intraday-Zeitpunkte bleiben erhalten; der noch offene dritte Bar faellt weg.
const parsed = parseYahooCandles(yahoo, "1h", (t0 + 2.5 * 3600) * 1000);
assert.equal(parsed.candles.length, 2);
assert.match(parsed.candles[0].date, /T/);
assert.equal(parsed.candles.every((x) => x.isClosed === true), true);
assert.equal(parsed.corporateActionCount, 1);

const bar = (i: number, high: number, low: number, close: number): Candle => {
  const openedAt = new Date((t0 + i * 3600) * 1000).toISOString();
  const closedAt = new Date((t0 + (i + 1) * 3600) * 1000).toISOString();
  return { date: openedAt, openedAt, closedAt, isClosed: true, open: close, high, low, close };
};
const base = [
  bar(0, 100, 99, 100),
  bar(1, 111, 108, 110),
  bar(2, 109, 99, 100),
  bar(3, 103, 97, 98),
  bar(4, 108, 99, 107),
];
const confirmedBefore = zigzag(base, 8);
const withProvisional = zigzag(base, 8, true);
const confirmedAfter = zigzag([...base, bar(5, 120, 106, 118)], 8);
assert.deepEqual(confirmedAfter, confirmedBefore);
assert.equal(withProvisional.at(-1)?.status, "PROVISIONAL");
assert.equal(confirmedBefore.every((x) => x.status !== "PROVISIONAL"), true);

// Zwei lineare/logarithmische Varianten derselben Idee sind eine Familie.
const pseudo = clusterLevels([
  { price: 100, label: "Retr 0.618", family: "IMPULSE_RETRACEMENT" },
  { price: 101, label: "logRetr 0.618", family: "IMPULSE_RETRACEMENT" },
]);
assert.equal(pseudo[0].score, 1);
assert.equal(pseudo[0].evidenceCount, 2);
const independent = clusterLevels([
  ...[
    { price: 100, label: "Retr 0.618", family: "IMPULSE_RETRACEMENT" as const },
    { price: 101, label: "logRetr 0.618", family: "IMPULSE_RETRACEMENT" as const },
  ],
  { price: 100.5, label: "W4-Zone", family: "PRIOR_WAVE" },
]);
assert.equal(independent[0].score, 2);

const setup: FrozenSetup = {
  direction: "LONG",
  trigger: 105,
  invalidation: 95,
  cExtreme: 98,
  createdAt: "2026-01-01T00:00:00.000Z",
  asOf: "2026-01-08T00:00:00.000Z",
};
const decisionBar = (closedAt: string, close: number, high = close, low = close): Candle => ({
  date: new Date(Date.parse(closedAt) - 86_400_000).toISOString(),
  closedAt,
  open: close,
  high,
  low,
  close,
  isClosed: true,
});
assert.equal(evaluatePendingBar(setup, decisionBar(setup.asOf, 110)).type, "WAIT");
assert.equal(
  evaluatePendingBar(setup, decisionBar("2026-01-15T00:00:00.000Z", 106)).type,
  "CONFIRMED"
);

const trade: FrozenTrade = {
  direction: "LONG",
  entry: 100,
  invalidation: 90,
  target: 120,
  entryAt: "2026-01-01T00:00:00.000Z",
};
// Same-Bar-Kollision: Stop zuerst.
assert.equal(
  evaluateTradeBar(trade, decisionBar("2026-01-02T00:00:00.000Z", 110, 121, 89)).type,
  "INVALIDATED"
);
// Positiver Zeitablauf ist TIMEOUT, kein kuenstlicher Treffer.
assert.equal(
  evaluateTradeBar(trade, decisionBar("2026-02-01T00:00:00.000Z", 110, 111, 99)).type,
  "TIMEOUT"
);

console.log("✅ V170 Point-in-Time-Regressionspruefung bestanden");
