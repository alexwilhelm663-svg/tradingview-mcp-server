import type { DeepDecision } from "./deepDecision";
import type { MultiWaveRead } from "./multiWave";
import { themeContext, tradeOption } from "./aiThemes";

export function parseAnalyse(text: string): { symbol: string; interval: string; range: string; detail: boolean } {
  const [, symbol = "", ...args] = text.trim().split(/\s+/);
  if (!/^[A-Za-z0-9^][A-Za-z0-9.^=_-]{0,39}$/.test(symbol)) throw new Error("Symbol fehlt oder ist ungültig.");
  const daily = ["1d", "d", "day", "daily", "tag"];
  const weekly = ["1w", "1wk", "w", "week", "weekly", "woche"];
  const ranges = ["1y", "2y", "5y", "10y", "max"];
  const details = ["detail", "voll", "full", "alles"];
  const tokens = args.map(x => x.toLowerCase());
  if (tokens.some(x => ![...daily, ...weekly, ...ranges, ...details].includes(x))) throw new Error("Unbekanntes Argument.");
  if (tokens.some(x => daily.includes(x)) && tokens.some(x => weekly.includes(x))) throw new Error("Nur ein Intervall angeben.");
  if (new Set(tokens.filter(x => ranges.includes(x))).size > 1) throw new Error("Nur ein Zeitfenster angeben.");
  const isDaily = tokens.some(x => daily.includes(x));
  return { symbol: symbol.toUpperCase(), interval: isDaily ? "1d" : "1wk",
    range: tokens.find(x => ranges.includes(x)) ?? (isDaily ? "1y" : "5y"),
    detail: tokens.some(x => details.includes(x)) };
}

export function buildDecisionSummary(input: {
  trend: string; asOf: string; decision?: DeepDecision;
  structures: (MultiWaveRead | null)[]; symbol: string;
}): string {
  const d = input.decision;
  const correction = d?.status === "CONFIRMED" ? "Umkehr-Setup bestätigt (Abschluss bleibt Zählhypothese)"
    : d && ["CANDIDATE", "PENDING"].includes(d.status) ? "Abschluss-Kandidat; Trigger fehlt noch"
    : d?.status === "IMPULSE_ACTIVE" ? "Kein bestätigter Abschluss; Impuls aktiv"
    : "Nicht bestätigt";
  const structures = input.structures.filter((s): s is MultiWaveRead => !!s && s.intact && s.legs >= 1);
  const units = structures.length ? Math.max(...structures.map(s => s.legs)) : 0;
  const context = themeContext(input.symbol);
  return `Trend: ${input.trend === "bullish" ? "BULLISH" : input.trend === "bearish" ? "BEARISH" : "UNKNOWN"} (gezählter Impuls)\n` +
    `Korrektur: ${correction}\n` +
    `1,2-Setup: ${units ? `${units} intakte Einheit(en); kein Einstieg allein daraus` : "Keines bestätigt"}\n` +
    `${tradeOption(d)}\nDatenstand: ${input.asOf.slice(0, 10)}` +
    (context ? `\nKI-Kontext: ${context.split("\n").filter(x => x.includes("AI_")).join(" · ")}` : "");
}
