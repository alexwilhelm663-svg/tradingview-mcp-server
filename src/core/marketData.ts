import { createHash } from "node:crypto";

export interface Candle {
  /** Kanonischer UTC-Zeitpunkt des Bar-Beginns (ISO-8601, nie nur YYYY-MM-DD). */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  /** Explizite Point-in-Time-Metadaten; bei alten Test-Fixtures optional. */
  openedAt?: string;
  closedAt?: string;
  timestamp?: number;
  isClosed?: boolean;
}

export interface DataProvenance {
  provider: "yahoo-chart";
  symbol: string;
  interval: string;
  range: string;
  fetchedAt: string;
  asOf: string;
  firstBarOpen: string | null;
  lastBarClose: string | null;
  dataHash: string;
  adjustment: "RAW_PROVIDER_OHLC";
  corporateActionCount: number;
}

/** V164: Fehler bei zu kurzer Historie - vom Aufrufer auswertbar. */
export interface ThinHistoryError extends Error {
  thinHistory: true;
  symbol: string;
  have: number;
  need: number;
  firstTrade: string | null;
}

export function isThinHistory(e: any): e is ThinHistoryError {
  return !!e && e.thinHistory === true;
}

export interface MarketData {
  weeklyAnalysisCandles: Candle[];
  provenance: DataProvenance;
}

const DAY_MS = 86_400_000;

function intervalDurationMs(interval: string): number {
  const m = /^(\d+)(m|h|d|wk|mo)$/.exec(interval);
  if (!m) throw new Error(`Nicht unterstuetztes Yahoo-Intervall: ${interval}`);
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === "m") return n * 60_000;
  if (unit === "h") return n * 3_600_000;
  if (unit === "d") return n * DAY_MS;
  if (unit === "wk") return n * 7 * DAY_MS;
  return n * 31 * DAY_MS;
}

export function candleCloseTime(candle: Candle): string {
  return candle.closedAt ?? candle.date;
}

export function candleCloseMs(candle: Candle): number {
  const ms = Date.parse(candleCloseTime(candle));
  if (!Number.isFinite(ms)) throw new Error(`Ungueltiger Kerzenzeitpunkt: ${candleCloseTime(candle)}`);
  return ms;
}

export function hashCandles(candles: Candle[]): string {
  const canonical = candles.map((c) => [
    c.date,
    candleCloseTime(c),
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume ?? 0,
  ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ParsedYahooCandles {
  candles: Candle[];
  corporateActionCount: number;
}

/** Pure Parser-Funktion fuer Live und Regressionstests. */
export function parseYahooCandles(
  result: any,
  interval: string,
  asOfMs: number
): ParsedYahooCandles {
  const quote = result?.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = result?.timestamp ?? [];
  const stepMs = intervalDurationMs(interval);
  const byOpen = new Map<number, Candle>();

  for (let i = 0; i < timestamps.length; i++) {
    const openSec = Number(timestamps[i]);
    const open = Number(quote.open?.[i] ?? quote.close?.[i]);
    const high = Number(quote.high?.[i]);
    const low = Number(quote.low?.[i]);
    const close = Number(quote.close?.[i]);
    if (![openSec, open, high, low, close].every(Number.isFinite)) continue;
    if (openSec <= 0 || low <= 0 || high < low) continue;

    const openedMs = openSec * 1000;
    const nextMs = Number(timestamps[i + 1]) * 1000;
    const closedMs = Number.isFinite(nextMs) && nextMs > openedMs
      ? nextMs
      : openedMs + stepMs;
    if (closedMs > asOfMs) continue;

    const openedAt = new Date(openedMs).toISOString();
    const closedAt = new Date(closedMs).toISOString();
    byOpen.set(openSec, {
      date: openedAt,
      openedAt,
      closedAt,
      timestamp: openSec,
      isClosed: true,
      open,
      high,
      low,
      close,
      volume: Number(quote.volume?.[i] ?? 0),
    });
  }

  const events = result?.events ?? {};
  const corporateActionCount = Object.values(events).reduce(
    (sum: number, group: any) => sum + Object.keys(group ?? {}).length,
    0
  );
  return {
    candles: [...byOpen.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)),
    corporateActionCount,
  };
}

/**
 * Holt ausschliesslich abgeschlossene OHLC-Kerzen. `asOfMs` ist injizierbar,
 * damit Live und Replay denselben Point-in-Time-Cutoff verwenden. OHLC bleibt
 * explizit unadjustiert; Corporate Actions werden in der Provenienz erfasst.
 */
export async function fetchMarketData(
  symbol: string,
  interval = "1wk",
  range = "5y",
  minCandles = 50,
  asOfMs = Date.now()
): Promise<MarketData> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=${interval}&range=${range}&events=div%2Csplits&includeAdjustedClose=true`;

  const fetchedAt = new Date().toISOString();
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`Yahoo-API ${res.status} fuer ${symbol}`);

  const json: any = await res.json();
  if (json.chart?.error) {
    throw new Error(`Yahoo-API fuer ${symbol}: ${json.chart.error.description ?? "unbekannter Fehler"}`);
  }
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo-API liefert keine Daten fuer ${symbol}`);

  const parsed = parseYahooCandles(result, interval, asOfMs);
  const candles = parsed.candles;
  if (candles.length < minCandles) {
    const first = result?.meta?.firstTradeDate
      ? new Date(result.meta.firstTradeDate * 1000).toISOString().slice(0, 10)
      : candles[0]?.date.slice(0, 10) ?? null;
    const e = new Error(
      `Zu wenig abgeschlossene Kursdaten fuer ${symbol}: ${candles.length} von mindestens ${minCandles} Kerzen` +
        (first ? ` (Erstnotiz ${first})` : "")
    ) as ThinHistoryError;
    e.thinHistory = true;
    e.symbol = symbol;
    e.have = candles.length;
    e.need = minCandles;
    e.firstTrade = first;
    throw e;
  }

  const dataHash = hashCandles(candles);
  return {
    weeklyAnalysisCandles: candles,
    provenance: {
      provider: "yahoo-chart",
      symbol,
      interval,
      range,
      fetchedAt,
      asOf: new Date(asOfMs).toISOString(),
      firstBarOpen: candles[0]?.date ?? null,
      lastBarClose: candles.length > 0 ? candleCloseTime(candles[candles.length - 1]) : null,
      dataHash,
      adjustment: "RAW_PROVIDER_OHLC",
      corporateActionCount: parsed.corporateActionCount,
    },
  };
}
