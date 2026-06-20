import sys
import json
import io
import traceback
import pandas as pd
import matplotlib
matplotlib.use('Agg') # Headless Mode
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

def main():
    try:
        json_str = sys.stdin.read()
        if not json_str:
            print("Error: Leerer Datenstrom von Node.js", file=sys.stderr)
            sys.exit(1)
            
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
        symbol = data.get("symbol", "Symbol") # Symbol für den Titel abgreifen

        if not candles:
            print("Error: Keine Kerzendaten zum Zeichnen erhalten.", file=sys.stderr)
            sys.exit(1)

        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)

        df['close'] = df['close'].astype(float)
        
        wave_dates = []
        wave_prices = []
        wave_labels = []

        for w in waves:
            # Datums-Parsing flexibilisieren
            raw_date_str = str(w['date'])
            if "-Q" in raw_date_str or "-q" in raw_date_str:
                parts = raw_date_str.upper().split("-Q")
                year = parts[0]
                q = parts[1]
                month = {"1": "02", "2": "05", "3": "08", "4": "11"}.get(q, "06")
                target_date = pd.to_datetime(f"{year}-{month}-15")
            else:
                target_date = pd.to_datetime(raw_date_str, errors='coerce')
                if pd.isna(target_date):
                    continue

            # Snap exakt auf die vorhandene Kurslinie
            if target_date in df.index:
                actual_date = target_date
            else:
                if len(df.index) > 0:
                    idx = df.index.get_indexer([target_date], method='nearest')[0]
                    actual_date = df.index[idx]
                else:
                    continue
            
            price = df.loc[actual_date, 'close']
            if isinstance(price, pd.Series):
                price = price.iloc[0]
                
            wave_dates.append(actual_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])

        # ==========================================
        # 🎨 DASHBOARD AESTHETICS (TradingView Style)
        # ==========================================
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color = '#282b30'
        grid_color = '#404249'
        spine_color = '#60646D'
        text_color = '#dddddd'
        cyan = '#00bcd4'
        magenta = '#e91e63'
        title_white = '#ffffff'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        
        # 1. Close-Preis als Cyan-Linie
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        # 2. Elliott-Wellen als Magenta-Vektoren
        if len(wave_dates) > 1:
            ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2, marker='o', markersize=12, label='Welle V-Impuls (Subwellen)')
            
        # 3. Frei schwebende, dicke Labels
        y_range = df['close'].max() - df['close'].min()
        offset = y_range * 0.035
        
        for i, (date, price, label) in enumerate(zip(wave_dates, wave_prices, wave_labels)):
            if label in ['1', '3', '5', 'I', 'III', 'V', 'A', 'C']:
                y_pos = price + offset
                va = 'bottom'
            elif label in ['0', '2', '4', 'II', 'IV', 'B', 'Start']:
                y_pos = price - offset
                va = 'top'
            else:
                y_pos = price + offset if i % 2 == 0 else price - offset
                va = 'bottom' if i % 2 == 0 else 'top'

            ax.text(date, y_pos, label, color=magenta, fontsize=24, fontweight='bold', ha='center', va=va)
            
        # 4. Gitter & Umrandung
        ax.grid(True, color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values():
            spine.set_color(spine_color)
            spine.set_linewidth(1)
            
        ax.tick_params(axis='both', colors=text_color, labelsize=11, length=5, color=spine_color)
        
        # 5. Achsenbeschriftung
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        formatter = mdates.ConciseDateFormatter(locator)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(formatter)
        
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:.2f}"))
        
        # 6. Zweifarbiger, zentrierter Titel
        fig.text(0.5, 0.92, f"{symbol} - ", color=title_white, fontsize=22, ha='right', va='center')
        fig.text(0.5, 0.92, "Elliott-Wellen-Analyse (Makro-Impuls)", color=cyan, fontsize=22, ha='left', va='center')
        
        # 7. Legende
        handles, labels = ax.get_legend_handles_labels()
        try:
            w_idx = labels.index('Welle V-Impuls (Subwellen)')
            c_idx = labels.index('Close Price')
            handles = [handles[w_idx], handles[c_idx]]
            labels = [labels[w_idx], labels[c_idx]]
        except ValueError:
            pass

        legend = ax.legend(handles, labels, loc='upper left', facecolor=bg_color, edgecolor=grid_color, fontsize=12, framealpha=1, borderpad=0.8)
        for text in legend.get_texts():
            text.set_color(title_white)
            
        plt.subplots_adjust(top=0.85, bottom=0.1, left=0.08, right=0.95)
        
        # Rendern & Output
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=150, facecolor=fig.get_facecolor(), edgecolor='none')
        buf.seek(0)
        
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.flush()
        
    except Exception as e:
        print(f"Python Crash Log:\n{traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
