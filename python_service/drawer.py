import sys
import json
import io
import traceback
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import timedelta

def main():
    telemetry_log = []
    
    try:
        json_str = sys.stdin.read()
        if not json_str:
            sys.exit(1)
            
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
        symbol = data.get("symbol", "Symbol")

        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)
        df['close'] = df['close'].astype(float)
        
        wave_dates = []
        wave_prices = []
        wave_labels = []

        for i, w in enumerate(waves):
            step_info = {"label": w['label'], "input_date": w['date'], "snapped": False}
            
            # 1. Datum parsen
            raw_date_str = str(w['date'])
            if "-Q" in raw_date_str or "-q" in raw_date_str:
                parts = raw_date_str.upper().split("-Q")
                m = {"1": "02", "2": "05", "3": "08", "4": "11"}.get(parts[1], "06")
                target_date = pd.to_datetime(f"{parts[0]}-{m}-15")
            else:
                target_date = pd.to_datetime(raw_date_str, errors='coerce')
                
            if pd.isna(target_date):
                step_info["error"] = "Invalid Date format"
                telemetry_log.append(step_info)
                continue

            step_info["parsed_target"] = str(target_date.date())

            # 2. Peak-Richtung bestimmen
            is_high = True
            if i > 0:
                is_high = w['price'] > waves[i-1]['price']
            elif len(waves) > 1:
                is_high = w['price'] > waves[1]['price']

            step_info["is_peak"] = is_high

            # 3. Magnet-Suche
            start_window = target_date - timedelta(days=35)
            end_window = target_date + timedelta(days=35)
            mask = (df.index >= start_window) & (df.index <= end_window)
            window_df = df[mask]
            
            actual_date = None
            if not window_df.empty:
                actual_date = window_df['close'].idxmax() if is_high else window_df['close'].idxmin()
                step_info["snap_method"] = "local_extrema_window_35d"
            elif len(df.index) > 0:
                idx = df.index.get_indexer([target_date], method='nearest')[0]
                actual_date = df.index[idx]
                step_info["snap_method"] = "fallback_nearest_indexer"

            if actual_date is not None:
                price = df.loc[actual_date, 'close']
                if isinstance(price, pd.Series): price = price.iloc[0]
                
                wave_dates.append(actual_date)
                wave_prices.append(price)
                wave_labels.append(w['label'])
                
                step_info["snapped"] = True
                step_info["final_date"] = str(actual_date.date())
                step_info["final_price"] = float(price)

            telemetry_log.append(step_info)

        # Telemetrie heimlich über stderr an Node.js flüstern
        print(json.dumps({"telemetry_version": "1.1", "steps": telemetry_log}, indent=2), file=sys.stderr)

        # --- TRADINGVIEW DASHBOARD PLOT ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#2B2D33', '#3B3E46', '#60646D'
        cyan, magenta, text_color = '#00BFA5', '#D81B60', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        if len(wave_dates) > 1:
            ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2, marker='o', markersize=12, label='Welle V-Impuls')
            
        y_range = df['close'].max() - df['close'].min()
        offset = y_range * 0.035
        
        for date, price, label in zip(wave_dates, wave_prices, wave_labels):
            is_peak_label = True
            if label in ['0', '2', '4', 'II', 'IV', 'B', 'Start']: is_peak_label = False
            
            y_pos = price + offset if is_peak_label else price - offset
            va = 'bottom' if is_peak_label else 'top'
            ax.text(date, y_pos, label, color=magenta, fontsize=24, fontweight='bold', ha='center', va=va)
            
        ax.grid(True, color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values(): spine.set_color(spine_color)
        ax.tick_params(axis='both', colors=text_color, labelsize=11, color=spine_color)
        
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:.2f}"))
        
        fig.text(0.5, 0.92, f"{symbol} - ", color='white', fontsize=22, ha='right', va='center')
        fig.text(0.5, 0.92, "Elliott-Wellen-Analyse", color=cyan, fontsize=22, ha='left', va='center')
        
        legend = ax.legend(loc='upper left', facecolor=bg_color, edgecolor=grid_color, fontsize=11)
        for t in legend.get_texts(): t.set_color('white')
            
        plt.subplots_adjust(top=0.85, bottom=0.1, left=0.08, right=0.95)
        
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=150, facecolor=bg_color, edgecolor='none')
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        
    except Exception as e:
        print(json.dumps({"fatal_error": traceback.format_exc()}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
        
