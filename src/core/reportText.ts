import { analyzeAsset } from "./engine";

/**
 * V162: Gemeinsame Textbausteine fuer Bot und CLI.
 *
 * Bisher setzte nur commands.ts den Report zusammen. Damit `npm run report`
 * und die Snapshot-Pruefung genau das testen, was im Telegram ankommt, muss
 * es EINE Quelle geben - sonst laufen Test und Realitaet auseinander, und der
 * Test prueft etwas, das niemand sieht.
 */

export interface ReportParts {
  caption: string;
  details: string;
  commentary: string | null;
  abstention: string | null;
  hasChart: boolean;
}

export function buildCaption(
  symbol: string,
  isDaily: boolean,
  range: string,
  r: { finalTrend: string | null; bigPicture: string | null }
): string {
  let caption = `📊 **${symbol}** · ${isDaily ? "Daily" : "Weekly"} (${range}) · Makro-Trend \`${r.finalTrend}\``;
  if (r.bigPicture) caption += `\n\n${r.bigPicture}`;
  return caption;
}

export function buildDetails(r: {
  clusterInfo: string | null;
  isBreakoutSetup: boolean;
  breakoutStatus: string | null;
  analysis: { analysis?: string } | null;
  confluenceNote: string | null;
}): string {
  let details = "🔬 **Details**\n";
  if (r.clusterInfo) details += `${r.clusterInfo}\n`;
  if (r.isBreakoutSetup) details += `${r.breakoutStatus}\n`;
  if (!r.clusterInfo && !r.isBreakoutSetup) details += "⚪ Aktuell in keiner Trigger-Zone.\n";
  if (r.analysis?.analysis) details += `\n${r.analysis.analysis}`;
  if (r.confluenceNote) details += `\n\n${r.confluenceNote}`;
  return details;
}

/** Vollstaendiger Report als Text - identisch zu dem, was der Bot verschickt. */
export async function buildReport(
  symbol: string,
  range = "5y",
  interval = "1wk",
  detail = true
): Promise<ReportParts> {
  const r: any = await analyzeAsset(symbol, range, interval, detail);
  if (!r.analysis) {
    return {
      caption: `🔍 **${symbol}** – Enthaltung (DK-7)\n${r.abstention ?? ""}`,
      details: "",
      commentary: r.commentary ?? null,
      abstention: r.abstention ?? null,
      hasChart: !!r.buffer,
    };
  }
  return {
    caption: buildCaption(symbol, interval === "1d", range, r),
    details: buildDetails(r),
    commentary: r.commentary ?? null,
    abstention: null,
    hasChart: !!r.buffer,
  };
}

export function joinReport(p: ReportParts): string {
  return [p.caption, p.details, p.commentary ? `💬 ${p.commentary}` : ""]
    .filter((s) => s && s.trim())
    .join("\n\n");
}
