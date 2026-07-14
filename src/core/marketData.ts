export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketData {
  weeklyAnalysisCandles: Candle[];
}

/**
 * Holt OHLC-Kerzen von der Yahoo-Finance-Chart-API.
 * Default: Weekly ueber 5 Jahre (fuer die EW-Makro-Zaehlung).
 */
export async function fetchMarketData(
  symbol: string,
  interval = "1wk",
  range = "5y",
  minCandles = 50
): Promise<MarketData> {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?interval=${interval}&range=${range}`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  if (!res.ok) throw new Error(`Yahoo-API ${res.status} fuer ${symbol}`);

  const json: any = await res.json();
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const timestamps: number[] = result?.timestamp ?? [];

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (quote.close?.[i] == null || quote.high?.[i] == null || quote.low?.[i] == null) continue;
    candles.push({
      date: new Date(timestamps[i] * 1000).toISOString().split("T")[0],
      open: Number(quote.open?.[i] ?? quote.close[i]),
      high: Number(quote.high[i]),
      low: Number(quote.low[i]),
      close: Number(quote.close[i]),
      volume: Number(quote.volume?.[i] ?? 0),
    });
  }

  if (candles.length < minCandles) {
    throw new Error(`Zu wenig Kursdaten fuer ${symbol} (${candles.length} Kerzen)`);
  }
  return { weeklyAnalysisCandles: candles };
}
