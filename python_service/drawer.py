import sys
import json
import pandas as pd
import matplotlib.pyplot as plt
import io
from datetime import timedelta

def draw_chart():
    try:
        # FIX: Liest die Daten jetzt vom stdin Stream
        input_data = sys.stdin.read()
        if not input_data:
            print("Fehler: Keine Daten empfangen.", file=sys.stderr)
            sys.exit(1)
            
        data = json.loads(input_data)
        
        candles = data.get("candles", [])
        waves_input = data.get("waves", [])
        
        if not candles:
            print("Fehler: Keine Candlestick-Daten empfangen.", file=sys.stderr)
            sys.exit(1)

        df = pd.DataFrame(candles)
        df['d'] = pd.to_datetime(df['d'])
        df.set_index('d', inplace=True)
        
        snapped_dates = []
        snapped_prices = []
        labels = []
        
        for i, w in enumerate(waves_input):
            try:
                target_date = pd.to_datetime(w['date'])
                
                if i > 0:
                    prev_price = waves_input[i-1]['price']
                    is_high = w['price'] > prev_price
                elif len(waves_input) > 1:
                    next_price = waves_input[1]['price']
                    is_high = w['price'] < next_price
                else:
                    is_high = True

                start_window = target_date - timedelta(days=14)
                end_window = target_date + timedelta(days=14)
                window_df = df.loc[start_window:end_window]
                
                if window_df.empty:
                    nearest_idx = df.index.get_indexer([target_date], method='nearest')[0]
                    snapped_date = df.index[nearest_idx]
                    snapped_price = df.iloc[nearest_idx]['h'] if is_high else df.iloc[nearest_idx]['l']
                else:
                    if is_high:
                        snapped_date = window_df['h'].idxmax()
                        snapped_price = window_df.loc[snapped_date, 'h']
                    else:
                        snapped_date = window_df['l'].idxmin()
                        snapped_price = window_df.loc[snapped_date, 'l']
                
                snapped_dates.append(snapped_date)
                snapped_prices.append(snapped_price)
                labels.append(w['label'])
            except Exception:
                pass 

        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(12, 6))
        fig.patch.set_facecolor('#121212')
        ax.set_facecolor('#121212')

        up = df[df['c'] >= df['o']]
        down = df[df['c'] < df['o']]
        
        ax.vlines(up.index, up['l'], up['h'], color='#00ffcc', linewidth=1)
        ax.vlines(down.index, down['l'], down['h'], color='#ff00ff', linewidth=1)
        
        width = timedelta(days=3)
        ax.bar(up.index, up['c'] - up['o'], width, bottom=up['o'], color='#00ffcc')
        ax.bar(down.index, down['o'] - down['c'], width, bottom=down['c'], color='#ff00ff')

        if len(snapped_dates) > 1:
            ax.plot(snapped_dates, snapped_prices, color='white', linewidth=2, linestyle='-', marker='o', markersize=6)
            
            for i, txt in enumerate(labels):
                y_offset = 15 if (i == 0 or snapped_prices[i] >= snapped_prices[i-1]) else -25
                ax.annotate(txt, (snapped_dates[i], snapped_prices[i]), 
                            textcoords="offset points", xytext=(0, y_offset), 
                            ha='center', color='yellow', fontsize=12, fontweight='bold')

        plt.title('Elliott-Wellen-Analyse (Auto-Snapping)', color='white', fontsize=14)
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
    
