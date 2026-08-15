import db from "./db";

/**
 * V143: Feedback-Loop des Kritikers.
 *
 * Nicht die Momentmeinung des Kritikers wirkt, sondern seine TRACK RECORD.
 * Aus abgeschlossenen Trades wird je Confidence-Band und je Flag die
 * Trefferquote berechnet. Bewaehrt sich ein Band historisch nicht, hebt das
 * die Score-Schwelle fuer neue Setups an - abgeleitet aus realisierten
 * Ergebnissen, nicht aus der Selbsteinschaetzung des Modells.
 *
 * Der LLM bleibt damit aus dem kritischen Pfad: er kann Anforderungen
 * verschaerfen, aber niemals eine Zaehlung setzen oder ein Setup erzeugen.
 * Ohne ausreichende Stichprobe passiert nichts (neutral).
 */

export interface FeedbackAdjustment {
  penalty: number; // 0..2 zusaetzlich geforderte Score-Punkte
  note: string | null;
}

const NEUTRAL: FeedbackAdjustment = { penalty: 0, note: null };
const MIN_N_BAND = 8;
const MIN_N_FLAG = 6;

interface Tally { n: number; w: number }

function tally(sql: string, ...args: any[]): Tally | null {
  try {
    const r: any = db.prepare(sql).get(...args);
    if (!r || !r.n) return null;
    return { n: Number(r.n), w: Number(r.w ?? 0) };
  } catch {
    return null; // Spalte/Tabelle fehlt -> neutral
  }
}

function bandTally(lo: number, hi: number): Tally | null {
  return tally(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS w
     FROM trade_history
     WHERE is_success IS NOT NULL
       AND confidence IS NOT NULL AND confidence >= ? AND confidence < ?`,
    lo, hi
  );
}

function flagTally(flag: string): Tally | null {
  return tally(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) AS w
     FROM trade_history WHERE is_success IS NOT NULL AND flags LIKE ?`,
    `%${flag}%`
  );
}

/** Hebt die Setup-Schwelle, wenn sich Band oder Flag historisch nicht traegt. */
export function feedbackPenalty(
  critique: { confidence: number; flags: string[] } | null
): FeedbackAdjustment {
  if (!critique) return NEUTRAL;
  const c = critique.confidence;
  const lo = c >= 70 ? 70 : c >= 40 ? 40 : 0;
  const hi = c >= 70 ? 101 : c >= 40 ? 70 : 40;

  let penalty = 0;
  const parts: string[] = [];

  const b = bandTally(lo, hi);
  if (b && b.n >= MIN_N_BAND) {
    const wr = b.w / b.n;
    if (wr < 0.25) {
      penalty += 2;
      parts.push(`Band ${lo}-${hi - 1}: ${(wr * 100).toFixed(0)}% (n=${b.n})`);
    } else if (wr < 0.4) {
      penalty += 1;
      parts.push(`Band ${lo}-${hi - 1}: ${(wr * 100).toFixed(0)}% (n=${b.n})`);
    }
  }

  for (const f of critique.flags ?? []) {
    if (penalty >= 2) break;
    const s = flagTally(f);
    if (s && s.n >= MIN_N_FLAG) {
      const wr = s.w / s.n;
      if (wr < 0.35) {
        penalty += 1;
        parts.push(`${f}: ${(wr * 100).toFixed(0)}% (n=${s.n})`);
      }
    }
  }

  penalty = Math.min(penalty, 2);
  if (penalty === 0) return NEUTRAL;
  return { penalty, note: `Feedback: Schwelle +${penalty} (${parts.join(", ")})` };
}

/** Kompakte Kalibrierungs-Uebersicht fuer Reports. */
export function calibrationSummary(): string {
  const rows: string[] = [];
  for (const [lo, hi, label] of [[70, 101, ">=70"], [40, 70, "40-69"], [0, 40, "<40"]] as const) {
    const t = bandTally(lo, hi);
    rows.push(
      t ? `${label}: ${((t.w / t.n) * 100).toFixed(0)}% (n=${t.n})` : `${label}: keine Daten`
    );
  }
  return rows.join(" \u00b7 ");
}
