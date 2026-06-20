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
    try:
        json_str = sys.stdin.read()
        if not json_str:
            sys.exit(1)
            
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
        symbol = data.get("symbol", "Symbol")

        if not candles or not waves:
            # Fallback-Fehlerbild, falls wider Erwarten leere Daten ankommen
            fig, ax = plt.subplots(figsize=(12, 6))
            fig.patch.set_facecolor('#2B2D33')
            ax.set_facecolor('#2B2D33')
            ax.text(0.5, 0.5, "No valid wave data received from TypeScript.", color='#D81B60', fontsize=18, ha='center', va='center')
            ax.axis('off')
            buf = io.BytesIO()
            fig.savefig(buf, format='png', dpi=150, facecolor='#2B2D33')
            buf.seek(0)
            sys.stdout.buffer.write(buf.getvalue())
            sys.exit(0)

        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)
        df['close'] = df['close'].astype(float)
        
        # 1. Startpunkt (Welle 0) validieren und Chart exakt am echten Makro-Boden abschneiden
        w0 = waves[0]
        w0_target = pd.to_datetime(w0['date'], errors='coerce')
        
        if pd.isna(w0_target) or df.empty:
            sys.exit(1)

        # Großzügiges Suchfenster für den Makro-Start (±45 Tage)
        start_mask = (df.index >= (w0_target - timedelta(days=45))) & (df.index <= (w0_target + timedelta(days=45)))
        start_win = df[start_mask]
        
        if not start_win.empty:
            crop_date = start_win['close'].idxmin()
        else:
            idx = df.index.get_indexer([w0_target], method='nearest')[0]
            crop_date = df.index[idx]

        # Beschneide den DataFrame hart ab dem Makro-Boden
        df = df.loc[crop_date:]
        
        if df.empty: sys.exit(1)

        wave_dates, wave_prices, wave_labels, is_peak_list = [], [], [], []

        for i, w in enumerate(waves):
            t_date = pd.to_datetime(w['date'], errors='coerce')
            if pd.isna(t_date): continue

            if i == 0:
                actual_date = crop_date
                is_peak = False # Welle 0 liegt unten
            else:
                is_peak = w['price'] > waves[i-1]['price']
                
                # Suchfenster im beschnittenen Chart (±30 Tage)
                mask = (df.index >= (t_date - timedelta(days=30))) & (df.index <= (t_date + timedelta(days=30)))
                win = df[mask]
                
                if not win.empty:
                    actual_date = win['close'].idxmax() if is_peak else win['close'].idxmin()
                else:
                    idx = df.index.get_indexer([t_date], method='nearest')[0]
                    actual_date = df.index[idx]

            price = df.loc[actual_date, 'close']
            if isinstance(price, pd.Series): price = price.iloc[0]

            wave_dates.append(actual_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])
            is_peak_list.append(is_peak)

        # --- PLOT DASHBOARD (TradingView Dark Theme) ---
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
        
        # Sauberer Puffer links und rechts, damit dicke Zahlen nicht am Rand kleben
        ax.set_xlim(df.index.min() - timedelta(days=10), df.index.max() + timedelta(days=10))
            
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
    
