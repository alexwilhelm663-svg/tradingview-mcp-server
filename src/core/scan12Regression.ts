import assert from "node:assert/strict";
import type { Candle } from "./marketData";
import {
  findCloseBreach,
  isActionableMultiWave,
  preferMultiWaveCandidate,
  type MultiWaveRead,
} from "./multiWave";

const candle = (date: string, close: number): Candle => ({
  date,
  open: close,
  high: close,
  low: close,
  close,
});

// Ein spaeterer Schluss unter 268 invalidiert den alten Long-Count dauerhaft.
const longBreak = findCloseBreach(
  [
    candle("2026-08-01", 275),
    candle("2026-08-02", 267),
    candle("2026-08-03", 271),
  ],
  "2026-08-01",
  268,
  1
);
assert.deepEqual(longBreak, { date: "2026-08-02", close: 267 });

// Die Rueckkehr ueber die Marke darf den historischen Bruch nicht loeschen.
assert.equal(longBreak?.date, "2026-08-02");

const points = (date: string) => [
  { label: "", date: "2026-01-01", price: 100 },
  { label: "1", date: "2026-02-01", price: 130 },
  { label: "2", date, price: 115 },
];
const read = (overrides: Partial<MultiWaveRead>): MultiWaveRead => ({
  active: false,
  nested: false,
  legs: 2,
  currentInvalidation: 115,
  intact: true,
  breachDate: null,
  breachClose: null,
  note: "2× 1-2",
  points: points("2026-03-01"),
  ...overrides,
});

// Ein intakter Kandidat muss immer vor einem alten gebrochenen gewinnen.
const staleBroken = read({
  nested: true,
  intact: false,
  breachDate: "2026-04-01",
  breachClose: 110,
  note: "gebrochen",
  points: points("2026-02-15"),
});
const currentIntact = read({ points: points("2026-03-15") });
assert.equal(preferMultiWaveCandidate(currentIntact, staleBroken), true);
assert.equal(preferMultiWaveCandidate(staleBroken, currentIntact), false);
assert.equal(isActionableMultiWave(currentIntact), true);
assert.equal(isActionableMultiWave(staleBroken), false);

console.log("✅ Scan12-Regressionspruefung bestanden");
