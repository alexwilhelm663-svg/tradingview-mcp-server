import type { Candle } from "./marketData";
import { candleCloseTime } from "./marketData";
import { daysBetween, timeMs } from "./time";
import type { Direction } from "./forecast";

export const PENDING_TIMEOUT_DAYS = 84;
export const TRADE_TIMEOUT_DAYS = 30;

export interface FrozenSetup {
  direction: Direction;
  trigger: number;
  invalidation: number;
  cExtreme: number;
  createdAt: string;
  asOf: string;
  lastEvaluatedBar?: string | null;
}

export type PendingDecision =
  | { type: "WAIT"; effectiveAt: string; reason: "STALE_BAR" | "PENDING" }
  | { type: "INVALIDATED"; effectiveAt: string }
  | { type: "TIMEOUT"; effectiveAt: string }
  | {
      type: "CONFIRMED" | "DEGENERATE";
      effectiveAt: string;
      entry: number;
      target: number;
      potentialR: number;
    };

/** Eine einzige Zustandsregel fuer produktive Aufloesung und Replay. */
export function evaluatePendingBar(setup: FrozenSetup, bar: Candle): PendingDecision {
  const effectiveAt = candleCloseTime(bar);
  const lowerBound = setup.lastEvaluatedBar && timeMs(setup.lastEvaluatedBar) > timeMs(setup.asOf)
    ? setup.lastEvaluatedBar
    : setup.asOf;
  if (timeMs(effectiveAt) <= timeMs(lowerBound)) {
    return { type: "WAIT", effectiveAt, reason: "STALE_BAR" };
  }

  const s2 = setup.direction === "LONG" ? 1 : -1;
  const invalidated = s2 * (bar.close - setup.invalidation) < 0;
  if (invalidated) return { type: "INVALIDATED", effectiveAt };

  const triggered = s2 * (bar.close - setup.trigger) > 0;
  if (triggered) {
    const entry = bar.close;
    const target = setup.trigger + s2 * 1.618 * Math.abs(setup.trigger - setup.cExtreme);
    const risk = Math.abs(entry - setup.invalidation);
    const potentialR = risk > 0 ? (s2 * (target - entry)) / risk : -1;
    return {
      type: potentialR >= 0.25 ? "CONFIRMED" : "DEGENERATE",
      effectiveAt,
      entry,
      target,
      potentialR,
    };
  }

  if (daysBetween(setup.createdAt, effectiveAt) >= PENDING_TIMEOUT_DAYS) {
    return { type: "TIMEOUT", effectiveAt };
  }
  return { type: "WAIT", effectiveAt, reason: "PENDING" };
}

export interface FrozenTrade {
  direction: Direction;
  entry: number;
  invalidation: number;
  target: number;
  entryAt: string;
}

export type TradeDecision =
  | { type: "WAIT"; effectiveAt: string }
  | {
      type: "TARGET" | "INVALIDATED" | "TIMEOUT";
      effectiveAt: string;
      exit: number;
      pnl: number;
      r: number;
    };

/** Stop wird bei einer Same-Bar-Kollision konservativ vor dem Ziel geprueft. */
export function evaluateTradeBar(trade: FrozenTrade, bar: Candle): TradeDecision {
  const effectiveAt = candleCloseTime(bar);
  if (timeMs(effectiveAt) <= timeMs(trade.entryAt)) return { type: "WAIT", effectiveAt };
  const s2 = trade.direction === "LONG" ? 1 : -1;
  const risk = Math.abs(trade.entry - trade.invalidation);
  const result = (type: "TARGET" | "INVALIDATED" | "TIMEOUT", exit: number): TradeDecision => ({
    type,
    effectiveAt,
    exit,
    pnl: (s2 * (exit - trade.entry)) / trade.entry,
    r: risk > 0 ? (s2 * (exit - trade.entry)) / risk : 0,
  });

  const stopHit = s2 === 1 ? bar.low <= trade.invalidation : bar.high >= trade.invalidation;
  if (stopHit) return result("INVALIDATED", trade.invalidation);
  const targetHit = s2 === 1 ? bar.high >= trade.target : bar.low <= trade.target;
  if (targetHit) return result("TARGET", trade.target);
  if (daysBetween(trade.entryAt, effectiveAt) >= TRADE_TIMEOUT_DAYS) {
    return result("TIMEOUT", bar.close);
  }
  return { type: "WAIT", effectiveAt };
}
