import type { DeepDecision } from "./deepDecision";

export const AI_THEMES = {
  AI_CAPITAL_ROTATION: {
    horizon: "Wochen bis Monate",
    hypothesis: "KI-Kapitalzuflüsse können BTC-Nachfrage verdrängen; Kursstärke allein beweist keine Kapitalrotation. Aktueller Einfluss: UNKNOWN ohne verifizierte Flows.",
    assets: [
      { symbol: "NVDA", role: "KI-Compute; Themenexposure" },
      { symbol: "AMD", role: "KI-Compute; Themenexposure" },
      { symbol: "MSFT", role: "Cloud/Modelle; diversifizierter Proxy" },
      { symbol: "AMZN", role: "Cloud; diversifizierter Proxy" },
      { symbol: "BTC-USD", role: "Vergleichsasset, möglicher Rotationsverlierer" },
    ],
  },
  AI_BITCOIN_ADOPTION: {
    horizon: "Quartale bis Jahre",
    hypothesis: "Agenten können BTC-Reserve- und Lightning-Liquiditätsbedarf erhöhen. Stablecoin-Zahlungen und technische Releases beweisen keine BTC-Nachfrage. Aktueller Einfluss: UNKNOWN ohne gemessene Nutzung/BTC-Bestände.",
    assets: [
      { symbol: "BTC-USD", role: "direktes BTC-Exposure" },
      { symbol: "MSTR", role: "BTC-Treasury-Proxy; Finanzierungs-/Prämienrisiko" },
      { symbol: "COIN", role: "Lightning und Stablecoins; gemischter Infrastruktur-Proxy" },
      { symbol: "CRCL", role: "Stablecoin-Konkurrenz/Kontrollasset, kein BTC-Adoptionsproxy" },
    ],
  },
} as const;

export type AITheme = keyof typeof AI_THEMES;

/** Kontext darf niemals Elliott-Gates oder eingefrorene Preislevel überschreiben. */
export function tradeOption(d?: DeepDecision): string {
  if (!d) return "ABWARTEN · keine belastbare Elliott-Entscheidung";
  const valid = [d.trigger, d.invalidation, d.target].every(x => x != null && Number.isFinite(x));
  if (!valid || !["CONFIRMED", "PENDING", "CANDIDATE"].includes(d.status)) {
    return `ABWARTEN · ${d.status}; kein freigegebenes Kauf-/Verkaufssignal`;
  }
  const long = d.direction === "LONG";
  const action = long ? "KAUF / LONG" : "VERKAUF / SHORT-KANDIDAT (Instrument/Leihe prüfen)";
  const timing = d.status === "CONFIRMED" ? "BESTÄTIGTES SETUP (kein neuer Einstiegspreis)"
    : `BEDINGT · erst nach Schlusskurs ${long ? ">" : "<"} ${d.trigger!.toFixed(2)}`;
  return `${action} · ${timing}\nInvalidierung ${d.invalidation!.toFixed(2)} · Modellziel ${d.target!.toFixed(2)} · Stand ${d.asOf.slice(0, 10)}`;
}

export function themeContext(symbol: string): string {
  return (Object.entries(AI_THEMES) as [AITheme, typeof AI_THEMES[AITheme]][])
    .filter(([, theme]) => theme.assets.some(a => a.symbol === symbol))
    .map(([name, theme]) => `${name} · ${theme.horizon} · UNKNOWN\n${theme.assets.find(a => a.symbol === symbol)!.role}`)
    .join("\n");
}
