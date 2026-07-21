import { spawn } from "child_process";
import path from "path";
import type { Candle } from "./marketData";

export interface ChartWave {
  label: string;
  date: string;
  price: number;
}

export interface ChartCluster {
  floor: number;
  ceiling: number;
  score: number;
  labels: string[];
}

export interface ChartMarker {
  price: number;
  label: string;
}

export interface ChartPayload {
  symbol: string;
  waves: ChartWave[];
  candles: Candle[];
  clusters?: ChartCluster[];
  markers?: ChartMarker[];
  titleSuffix?: string;
  timeWindows?: { start: string; end: string; label: string }[];
  subwaves?: ChartWave[];
  candlestick?: boolean; // V129: echte Tageskerzen statt Linie
}

/**
 * Rendert den EW-Chart ueber python_service/drawer.py.
 * Kontrakt: JSON auf stdin, PNG-Bytes auf stdout, Fehler auf stderr (Exit 1).
 * Gibt bei jedem Fehler null zurueck - die Analyse bleibt dann textbasiert.
 */
export function renderChart(payload: ChartPayload): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "python_service", "drawer.py");
    const py = spawn("python3", [script]);

    const chunks: Buffer[] = [];
    py.stdout.on("data", (d: Buffer) => chunks.push(d));
    py.stderr.on("data", (d: Buffer) =>
      console.error(`[drawer.py] ${d.toString().trim()}`)
    );
    py.on("close", (code) =>
      resolve(code === 0 && chunks.length > 0 ? Buffer.concat(chunks) : null)
    );
    py.on("error", (err) => {
      console.error("[drawer.py] Spawn-Fehler:", err.message);
      resolve(null);
    });

    py.stdin.write(JSON.stringify(payload));
    py.stdin.end();
  });
}
