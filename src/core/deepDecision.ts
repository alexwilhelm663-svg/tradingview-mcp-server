import type { FibCluster } from "./fibCluster";
import {
  forecastInvalidation,
  forecastTarget,
  type Direction,
  type ForecastInspection,
} from "./forecast";

export type DeepStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANDIDATE"
  | "WATCH"
  | "WAIT_C"
  | "OUTSIDE_WINDOW"
  | "IMPULSE_ACTIVE"
  | "NO_SETUP";

export interface PersistedDecision {
  status: "PENDING" | "CONFIRMED";
  direction: Direction;
  zone: FibCluster;
  trigger: number;
  invalidation: number;
  cExtreme: number;
  target: number;
  entry: number | null;
  snapshotId: string;
  asOf: string;
  dataHash: string;
  engineVersion: string;
  createdAt: string;
}

export interface DeepDecision {
  status: DeepStatus;
  direction: Direction;
  frozen: boolean;
  zone: FibCluster | null;
  trigger: number | null;
  invalidation: number | null;
  cExtreme: number | null;
  target: number | null;
  entry: number | null;
  potentialR: number | null;
  snapshotId: string | null;
  asOf: string;
  dataHash: string;
  engineVersion: string;
  createdAt: string | null;
}

function potentialR(
  direction: Direction,
  entry: number,
  invalidation: number,
  target: number
): number | null {
  const risk = Math.abs(entry - invalidation);
  if (!(risk > 0)) return null;
  const s = direction === "LONG" ? 1 : -1;
  const value = (s * (target - entry)) / risk;
  return Number.isFinite(value) ? value : null;
}

/** Frozen Snapshot > aktueller Kandidat > nicht handelbare Diagnose. */
export function selectDeepDecision(
  inspection: ForecastInspection,
  persisted: PersistedDecision | null
): DeepDecision {
  if (persisted) {
    const basis = persisted.entry ?? persisted.trigger;
    return {
      ...persisted,
      frozen: true,
      potentialR: potentialR(
        persisted.direction,
        basis,
        persisted.invalidation,
        persisted.target
      ),
    };
  }

  const setup = inspection.setup;
  if (setup) {
    const invalidation = forecastInvalidation(setup);
    const target = forecastTarget(setup);
    return {
      status: "CANDIDATE",
      direction: setup.direction,
      frozen: false,
      zone: setup.cluster,
      trigger: setup.trigger,
      invalidation,
      cExtreme: setup.cExtreme,
      target,
      entry: null,
      potentialR: potentialR(setup.direction, setup.trigger, invalidation, target),
      snapshotId: null,
      asOf: setup.asOf,
      dataHash: setup.dataHash,
      engineVersion: setup.engineVersion,
      createdAt: null,
    };
  }

  const status: DeepStatus = inspection.gate === "WATCH" ? "WATCH"
    : inspection.gate === "NO_C_EXTREME" ? "WAIT_C"
    : inspection.gate === "OUTSIDE_WINDOW" ? "OUTSIDE_WINDOW"
    : inspection.gate === "IMPULSE_ACTIVE" ? "IMPULSE_ACTIVE"
    : "NO_SETUP";
  return {
    status,
    direction: inspection.direction,
    frozen: false,
    zone: inspection.watchCluster,
    trigger: null,
    invalidation: null,
    cExtreme: inspection.cExtreme,
    target: null,
    entry: null,
    potentialR: null,
    snapshotId: null,
    asOf: inspection.asOf,
    dataHash: inspection.dataHash,
    engineVersion: inspection.engineVersion,
    createdAt: null,
  };
}
