const DAY_MS = 86_400_000;

/** Akzeptiert kanonische ISO-Zeitpunkte und alte SQLite-/YYYY-MM-DD-Werte. */
export function timeMs(value: string): number {
  const normalized = value.includes("T")
    ? value
    : value.includes(" ")
      ? value.replace(" ", "T") + (/[zZ]|[+-]\d\d:\d\d$/.test(value) ? "" : "Z")
      : `${value}T00:00:00.000Z`;
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) throw new Error(`Ungueltiger Zeitpunkt: ${value}`);
  return ms;
}

export function addDaysIso(value: string, days: number): string {
  return new Date(timeMs(value) + Math.round(days) * DAY_MS).toISOString();
}

export function daysBetween(a: string, b: string): number {
  return (timeMs(b) - timeMs(a)) / DAY_MS;
}

export function isoDate(value: string): string {
  return new Date(timeMs(value)).toISOString().slice(0, 10);
}
