import assert from "node:assert/strict";
import { AI_THEMES, themeContext, tradeOption } from "./aiThemes";
import type { DeepDecision } from "./deepDecision";

const base: DeepDecision = {
  status: "CANDIDATE", direction: "LONG", frozen: false, zone: null,
  trigger: 100, invalidation: 90, target: 120, cExtreme: 92,
  entry: null, potentialR: 2, snapshotId: null, asOf: "2026-10-01",
  dataHash: "fixture", engineVersion: "171", createdAt: null,
};
assert.match(tradeOption(base), /KAUF.*BEDINGT/);
assert.match(tradeOption({ ...base, direction: "SHORT" }), /VERKAUF.*SHORT/);
for (const status of ["WATCH", "WAIT_C", "OUTSIDE_WINDOW", "IMPULSE_ACTIVE", "NO_SETUP"] as const) {
  assert.match(tradeOption({ ...base, status }), /^ABWARTEN/);
}
assert.match(tradeOption({ ...base, trigger: NaN }), /^ABWARTEN/);
assert.match(tradeOption({ ...base, target: null }), /^ABWARTEN/);
assert.match(tradeOption({ ...base, status: "CONFIRMED" }), /kein neuer Einstiegspreis/);
assert.match(tradeOption(), /^ABWARTEN/);
assert.match(themeContext("BTC-USD"), /AI_CAPITAL_ROTATION/);
assert.match(themeContext("BTC-USD"), /AI_BITCOIN_ADOPTION/);
assert.equal(themeContext("P911.DE"), "");
assert.match(AI_THEMES.AI_BITCOIN_ADOPTION.assets.find(a => a.symbol === "CRCL")!.role, /kein BTC/);
console.log("AI themes: canonical gates, long/short options and proxy distinctions passed.");
