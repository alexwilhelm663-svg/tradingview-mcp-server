import sys
import json
import pandas as pd
import matplotlib.pyplot as plt
import io
from datetime import timedelta

def draw_chart():
    try:
        input_data = sys.stdin.read()
        if not input_data:
            sys.exit(1)
            
        data = json.loads(input_data)
        candles = data.get("candles", [])
        waves_input = data.get("waves", [])
        
        if not candles:
            sys.exit(1)

        # 1. Sicherer DataFrame OHNE Index-Magie
        df = pd.DataFrame(candles)
        df['d'] = pd.to_datetime(df['d'])
        df = df.sort_values('d').reset_index(drop=True)
        
        snapped_dates = []
        snapped_prices = []
        labels = []
        
        # 2. Wellen verarbeiten (mit puren Masken, kein .loc auf Indizes)
        for i, w in enumerate(waves_input):
            try:
                target_date = pd.to_datetime(w['date'])
                
                # Richtung bestimmen
                if i > 0:
                    is_high = w['price'] > waves_input[i-1]['price']
                elif len(waves_input) > 1:
                    is_high = w['price'] < waves_input[1]['price']
                else:
                    is_high = True

                # Suchfenster als boolesche Maske (sicherste Methode in Pandas)
                start_window = target_date - timedelta(days=14)
                end_window = target_date + timedelta(days=14)
                mask = (df['d'] >= start_window) & (df['d'] <= end_window)
                window_df = df[mask]
                
                if window_df.empty:
                    # Finde das absolute nächste Datum mathematisch (ohne get_indexer)
                    time_diffs = (df['d'] - target_date).abs()
                    nearest_idx = time_diffs.idxmin()
                    nearest_date = df.loc[nearest_idx, 'd']
                    
                    if time_diffs.min().days > 20:
                        snapped_date = target_date
                        snapped_price = w['price']
                    else:
                        snapped_date = nearest_date
                        snapped_price = df.loc[nearest_idx, 'h'] if is_high else df.loc[nearest_idx, 'l']
                else:
                    # Maximum/Minimum im Fenster finden
                    if is_high:
                        best_idx = window_df['h'].idxmax()
                        snapped_price = window_df.loc[best_idx, 'h']
                    else:
                        best_idx = window_df['l'].idxmin()
                        snapped_price = window_df.loc[best_idx, 'l']
                    snapped_date = window_df.loc[best_idx, 'd']
                
                snapped_dates.append(snapped_date)
                snapped_prices.append(snapped_price)
                labels.append(w['label'])
            except Exception:
                pass 

        # 3. Rendern
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(12, 6))
        fig.patch.set_facecolor('#121212')
        ax.set_facecolor('#121212')

        up = df[df['c'] >= df['o']]
        down = df[df['c'] < df['o']]
        
        # Kerzen explizit mit der Datums-Spalte ('d') zeichnen
        ax.vlines(up['d'], up['l'], up['h'], color='#00ffcc', linewidth=1)
        ax.vlines(down['d'], down['l'], down['h'], color='#ff00ff', linewidth=1)
        
        width = timedelta(days=3)
        ax.bar(up['d'], up['c'] - up['o'], width, bottom=up['o'], color='#00ffcc')
        ax.bar(down['d'], down['o'] - down['c'], width, bottom=down['c'], color='#ff00ff')

        # Wellen zeichnen
        if len(snapped_dates) > 1:
            ax.plot(snapped_dates, snapped_prices, color='white', linewidth=2, linestyle='-', marker='o', markersize=6)
            
            for i, txt in enumerate(labels):
                y_offset = 15 if (i == 0 or snapped_prices[i] >= snapped_prices[i-1]) else -25
                ax.annotate(txt, (snapped_dates[i], snapped_prices[i]), 
                            textcoords="offset points", xytext=(0, y_offset), 
                            ha='center', color='yellow', fontsize=12, fontweight='bold')

        plt.title('Elliott-Wellen-Analyse (Robuste Engine)', color='white', fontsize=14)
        plt.grid(color='#333333', linestyle='--', alpha=0.5)
        ax.tick_params(colors='white')
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
        buf.seek(0)
        
        sys.stdout.buffer.write(buf.getvalue())
        
    except Exception as e:
        print(f"Python Fehler: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    draw_chart()
    
