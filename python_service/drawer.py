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
    telemetry = []
    
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
        
        # 1. Orthodoxes Tief der Welle 0 suchen und Chart exakt dort abschneiden
        w0 = waves[0]
        w0_target = pd.to_datetime(w0['date'], errors='coerce')
        
        if pd.isna(w0_target) or df.empty:
            sys.exit(1)

        # Großes Suchfenster für den Zyklus-Start (±40 Tage)
        start_mask = (df.index >= (w0_target - timedelta(days=40))) & (df.index <= (w0_target + timedelta(days=40)))
        start_win = df[start_mask]
        
        if not start_win.empty:
            crop_date = start_win['close'].idxmin()
            snap_type = "snapped_to_40d_window_low"
        else:
            idx = df.index.get_indexer([w0_target], method='nearest')[0]
            crop_date = df.index[idx]
            snap_type = "fallback_nearest_indexer"

        # CHART ABSCHNEIDEN: Alles vor dem Makro-Boden wird gelöscht
        df = df.loc[crop_date:]
        
        telemetry.append({
            "step": "CHART_CROP (Wave 0 Start)",
            "ai_target": str(w0['date']),
            "snapped_start_date": str(crop_date.date()),
            "method": snap_type,
            "remaining_candles": len(df)
        })

        wave_dates, wave_prices, wave_labels, is_peak_list = [], [], [], []

        for i, w in enumerate(waves):
            t_date = pd.to_datetime(w['date'], errors='coerce')
            if pd.isna(t_date): continue

            if i == 0:
                actual_date = crop_date
                is_peak = False # Start ist unten
                m_used = snap_type
            else:
                is_peak = w['price'] > waves[i-1]['price']
                
                # Suchen im verbleibenden Chart-Fenster
                mask = (df.index >= (t_date - timedelta(days=30))) & (df.index <= (t_date + timedelta(days=30)))
                win = df[mask]
                
                if not win.empty:
                    actual_date = win['close'].idxmax() if is_peak else win['close'].idxmin()
                    m_used = "window_extrema_30d"
                else:
                    idx = df.index.get_indexer([t_date], method='nearest')[0]
                    actual_date = df.index[idx]
                    m_used = "nearest_fallback"

            price = df.loc[actual_date, 'close']
            if isinstance(price, pd.Series): price = price.iloc[0]

            wave_dates.append(actual_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])
            is_peak_list.append(is_peak)

            if i > 0:
                telemetry.append({
                    "wave": w['label'],
                    "ai_date": str(w['date']),
                    "snapped_date": str(actual_date.date()),
                    "price": float(price),
                    "is_peak": is_peak,
                    "method": m_used
                })

        print(json.dumps({"telemetry": telemetry}, indent=2), file=sys.stderr)

        # --- PLOT DASHBOARD ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#2B2D33', '#3B3E46', '#60646D'
        cyan, magenta, text_color = '#00BFA5', '#D81B60', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        if len(wave_dates) > 1:
            ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2, linestyle='-', marker='o', markersize=12, label='Welle V-Impuls')
            
        y_range = df['close'].max() - df['close'].min() if not df.empty else 100
        offset = y_range * 0.035
        
        for date, price, label, is_p in zip(wave_dates, wave_prices, wave_labels, is_peak_list):
            y_pos = price + offset if is_p else price - offset
            va = 'bottom' if is_p else 'top'
            ax.text(date, y_pos, label, color=magenta, fontsize=24, fontweight='bold', ha='center', va=va)
            
        ax.grid(True, color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values(): spine.set_color(spine_color)
        ax.tick_params(axis='both', colors=text_color, labelsize=11, color=spine_color)
        
        if not df.empty:
            # 8 Tage Puffer am Rand, damit dicke 12px-Punkte nicht am Rahmen kleben
            ax.set_xlim(df.index.min() - timedelta(days=8), df.index.max() + timedelta(days=8))
            
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
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"error": traceback.format_exc()}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
