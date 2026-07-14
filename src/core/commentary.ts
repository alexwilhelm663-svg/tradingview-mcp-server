import fs from "fs";
import path from "path";
import type { WaveCount } from "./impulseFinder";

/** Regelwerk v3 als Referenz fuer den Kritiker (mit Groessen-Guard). */
function loadRulebook(): string {
  try {
    const p = path.join(process.cwd(), "knowledge/rules/elliott_rules.md");
    if (!fs.existsSync(p)) return "";
    const txt = fs.readFileSync(p, "utf-8");
    return txt.length > 12000 ? txt.slice(0, 12000) : txt;
  } catch {
    return "";
  }
}

export interface Critique {
  confidence: number; // 0-100
  flags: string[];
  note: string;
}

// Fester Katalog: nur Bedenken, die NICHT deterministisch pruefbar sind.
const FLAG_CATALOG = [
  "ALTERNATIVE_COUNT",
  "PATTERN_ATYPISCH",
  "LATE_CYCLE_RISK",
  "MACRO_REGIME",
  "DATA_SUSPECT",
];

/**
 * Strukturierte LLM-Kritik (V114, Stufe 2): Gemini bewertet die fertige
 * deterministische Zaehlung als JSON {confidence, flags, note}. Die Flags
 * stammen aus einem festen Katalog und wirken stromabwaerts NUR als
 * Vorsichts-Asymmetrie (Setups werden konservativer, nie aggressiver).
 * Fehlender Key, Quota, Timeout oder unparsbares JSON -> null = Baseline.
 */
export async function getCritique(
  symbol: string,
  wc: WaveCount,
  currentPrice: number,
  clusterInfo: string,
  detFlags: string[]
): Promise<Critique | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const rulebook = loadRulebook();
  const prompt =
    `Du bist ein kritischer Elliott-Wave-Reviewer. Die Zaehlung wurde bereits deterministisch ` +
    `validiert und mit Qualitaets-Checks versehen - du lieferst NUR eine strukturierte Zweitmeinung.\n` +
    (rulebook
      ? `PRUEFE GEGEN DIESES REGELWERK und zitiere in "note" die relevanten Regel-IDs (z.B. GL-6, KO-3, DK-3):\n${rulebook}\n\n`
      : "") +
    `ANTWORTE AUSSCHLIESSLICH mit JSON, ohne Markdown, exakt in dieser Form:\n` +
    `{"confidence": <0-100>, "flags": [<0-3 Eintraege aus: ${FLAG_CATALOG.join(", ")}>], "note": "<hoechstens 40 Woerter Deutsch>"}\n\n` +
    `${symbol} @ ${currentPrice.toFixed(2)} | trend=${wc.trend}\n` +
    `Punkte: ${JSON.stringify(wc.points)}\n` +
    `Deterministische Flags: ${detFlags.length > 0 ? detFlags.join(", ") : "keine"}\n` +
    `Level-Kontext: ${clusterInfo || "keiner"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 160 },
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 && attempt === 0) {
        const txt = await res.text();
        const m = txt.match(/retry in ([0-9.]+)s/i);
        const waitMs = m ? Math.ceil(parseFloat(m[1]) * 1000) + 1000 : 20_000;
        console.warn(`[KRITIK] Rate-Limit - warte ${Math.round(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        console.warn(`[KRITIK] Gemini ${res.status} - Kritik entfaellt.`);
        return null;
      }
      const json: any = await res.json();
      const text: string | undefined = json?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text ?? "")
        .join(" ");
      return parseCritique(text ?? "");
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[KRITIK] Fehler (${err?.name ?? "unbekannt"}) - Kritik entfaellt.`);
      return null;
    }
  }
  return null;
}

/** Robuster Parser: Fences strippen, JSON extrahieren, Werte validieren. Fehler -> null. */
export function parseCritique(raw: string): Critique | null {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));

    const confRaw = Number(obj.confidence);
    if (!Number.isFinite(confRaw)) return null;
    const confidence = Math.max(0, Math.min(100, Math.round(confRaw)));

    const flags = Array.isArray(obj.flags)
      ? obj.flags.filter((f: unknown): f is string => typeof f === "string" && FLAG_CATALOG.includes(f)).slice(0, 3)
      : [];

    const note = typeof obj.note === "string" ? obj.note.trim().slice(0, 300) : "";
    return { confidence, flags, note };
  } catch {
    return null;
  }
}
