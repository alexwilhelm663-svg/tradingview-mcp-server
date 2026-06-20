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
            sys.exit(1)

        # 1. Gesamten Datensatz laden
        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)
        df['close'] = df['close'].astype(float)
        
        # 2. STRUKTURELLER START-CUT: Punkt 0 ermitteln und Chart beschneiden
        first_wave = waves[0]
        raw_start_date = pd.to_datetime(first_wave['date'], errors='coerce')
        
        # Richtung für Punkt 0 bestimmen (Standardmäßig ein Tiefpunkt bei bullischen Impulsen)
        is_high_start = False
        if len(waves) > 1:
            is_high_start = waves[0]['price'] > waves[1]['price']
            
        start_mask = (df.index >= (raw_start_date - timedelta(days=35))) & (df.index <= (raw_start_date + timedelta(days=35)))
        start_window = df[start_mask]
        
        if not start_window.empty:
            chart_start_date = start_window['close'].idxmin() if not is_high_start else start_window['close'].idxmax()
        else:
            idx = df.index.get_indexer([raw_start_date], method='nearest')[0]
            chart_start_date = df.index[idx]

        # JETZT ABSCHNEIDEN: Lösche alle Daten vor dem wahren Beginn der Motiven Welle
        df = df.loc[chart_start_date:]

        # 3. Restliche Wellen snappen
        wave_dates = []
        wave_prices = []
        wave_labels = []
        is_high_list = []

        for i, w in enumerate(waves):
            target_date = pd.to_datetime(w['date'], errors='coerce')
            if pd.isna(target_date):
                continue

            if i == 0:
                actual_date = chart_start_date
                is_high = is_high_start
            else:
                is_high = w['price'] > waves[i-1]['price']

            is_high_list.append(is_high)

            # Nur innerhalb des abgeschnittenen Bereichs suchen
            mask = (df.index >= (target_date - timedelta(days=35))) & (df.index <= (target_date + timedelta(days=35)))
            window_df = df[mask]
            
            if not window_df.empty:
                actual_date = window_df['close'].idxmax() if is_high else window_df['close'].idxmin()
            else:
                idx = df.index.get_indexer([target_date], method='nearest')[0]
                actual_date = df.index[idx]
            
            price = df.loc[actual_date, 'close']
            if isinstance(price, pd.Series):
                price = price.iloc[0]
                
            wave_dates.append(actual_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])

        # ==========================================
        # 🎨 DASHBOARD RENDERING (Exakt ab Punkt 0)
        # ==========================================
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#2B2D33', '#3B3E46', '#60646D'
        cyan, magenta, text_color = '#00BFA5', '#D81B60', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        
        # Kursverlauf startet exakt am ersten Punkt
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        if len(wave_dates) > 1:
            ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2, linestyle='-', marker='o', markersize=12, label='Welle V-Impuls')
            
        y_range = df['close'].max() - df['close'].min() if not df.empty else 100
        offset = y_range * 0.035
        
        for date, price, label, is_high in zip(wave_dates, wave_prices, wave_labels, is_high_list):
            y_pos = price + offset if is_high else price - offset
            va = 'bottom' if is_high else 'top'
            ax.text(date, y_pos, label, color=magenta, fontsize=24, fontweight='bold', ha='center', va=va)
            
        ax.grid(True, color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values():
            spine.set_color(spine_color)
        ax.tick_params(axis='both', colors=text_color, labelsize=11, color=spine_color)
        
        # Dynamische Achsenbegrenzung auf den neuen Zeitraum zwingen
        ax.set_xlim(df.index.min() - timedelta(days=5), df.index.max() + timedelta(days=5))
        
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:.2f}"))
        
        fig.text(0.5, 0.92, f"{symbol} - ", color='white', fontsize=22, ha='right', va='center')
        fig.text(0.5, 0.92, "Elliott-Wellen-Analyse (Fokussiert)", color=cyan, fontsize=22, ha='left', va='center')
        
        legend = ax.legend(loc='upper left', facecolor=bg_color, edgecolor=grid_color, fontsize=11)
        for t in legend.get_texts():
            t.set_color('white')
            
        plt.subplots_adjust(top=0.85, bottom=0.1, left=0.08, right=0.95)
        
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=150, facecolor=bg_color, edgecolor='none')
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.flush()
        
    except Exception as e:
        print(f"Python Fehler: {traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
