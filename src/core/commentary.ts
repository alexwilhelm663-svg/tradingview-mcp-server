import type { WaveCount } from "./impulseFinder";

/**
 * Optionale LLM-Zweitmeinung (V113): Gemini kommentiert die fertige
 * deterministische Zaehlung - es zaehlt nicht mehr selbst. Direkter
 * REST-Call ohne LangChain. Bei fehlendem Key, Quota oder Timeout
 * liefert die Funktion null und der Bot laeuft ungestoert weiter.
 */
export async function getCommentary(
  symbol: string,
  wc: WaveCount,
  currentPrice: number,
  clusterInfo: string
): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const prompt =
    `Du bist Elliott-Wave-Analyst. Die Zaehlung wurde bereits deterministisch validiert - ` +
    `bewerte sie NUR qualitativ in HOECHSTENS 50 Woertern (Deutsch, harte Grenze - laengere Antworten werden abgeschnitten): Charakter der laufenden Bewegung, ` +
    `groesstes Risiko fuer die Zaehlung. Keine neuen Wellenpunkte, keine Kursziele erfinden.\n` +
    `${symbol} @ ${currentPrice.toFixed(2)} | trend=${wc.trend}\n` +
    `Punkte: ${JSON.stringify(wc.points)}\n` +
    `Level-Kontext: ${clusterInfo || "keiner"}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 140 },
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
        console.warn(`[KOMMENTAR] Rate-Limit - warte ${Math.round(waitMs / 1000)}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (!res.ok) {
        console.warn(`[KOMMENTAR] Gemini ${res.status} - Kommentar entfaellt.`);
        return null;
      }
      const json: any = await res.json();
      const text: string | undefined = json?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p?.text ?? "")
        .join(" ")
        .trim();
      return text && text.length > 0 ? text : null;
    } catch (err: any) {
      clearTimeout(timer);
      console.warn(`[KOMMENTAR] Fehler (${err?.name ?? "unbekannt"}) - Kommentar entfaellt.`);
      return null;
    }
  }
  return null;
}
