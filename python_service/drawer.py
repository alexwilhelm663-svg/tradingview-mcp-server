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

        # 1. Sicherer DataFrame
        df = pd.DataFrame(candles)
        df['d'] = pd.to_datetime(df['d'])
        df = df.sort_values('d').reset_index(drop=True)
        
        snapped_x = []
        snapped_y = []
        labels = []
        
        # 2. X-Koordinate als reiner Integer (0, 1, 2...)
        for i, w in enumerate(waves_input):
            try:
                target_date = pd.to_datetime(w['date'])
                
                if i > 0:
                    is_high = w['price'] > waves_input[i-1]['price']
                elif len(waves_input) > 1:
                    is_high = w['price'] < waves_input[1]['price']
                else:
                    is_high = True

                start_window = target_date - timedelta(days=14)
                end_window = target_date + timedelta(days=14)
                mask = (df['d'] >= start_window) & (df['d'] <= end_window)
                window_df = df[mask]
                
                if window_df.empty:
                    time_diffs = (df['d'] - target_date).abs()
                    nearest_idx = time_diffs.idxmin()
                    
                    if time_diffs.min().days > 20:
                        days_diff = (target_date - df.loc[nearest_idx, 'd']).days
                        # Extrapoliert X in die Zukunft (5 Handelstage pro Woche)
                        x_coord = nearest_idx + int(days_diff * (5/7))
                        snapped_x.append(x_coord)
                        snapped_y.append(w['price'])
                    else:
                        snapped_x.append(nearest_idx)
                        snapped_y.append(df.loc[nearest_idx, 'h'] if is_high else df.loc[nearest_idx, 'l'])
                else:
                    if is_high:
                        best_idx = window_df['h'].idxmax()
                        snapped_y.append(window_df.loc[best_idx, 'h'])
                    else:
                        best_idx = window_df['l'].idxmin()
                        snapped_y.append(window_df.loc[best_idx, 'l'])
                    snapped_x.append(best_idx)
                
                labels.append(w['label'])
            except Exception:
                pass 

        # 3. Rendern (Ausschließlich mit Indizes, keine Dates!)
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(12, 6))
        fig.patch.set_facecolor('#121212')
        ax.set_facecolor('#121212')

        up = df[df['c'] >= df['o']]
        down = df[df['c'] < df['o']]
        
        ax.vlines(up.index, up['l'], up['h'], color='#00ffcc', linewidth=1)
        ax.vlines(down.index, down['l'], down['h'], color='#ff00ff', linewidth=1)
        
        width = 0.6
        ax.bar(up.index, up['c'] - up['o'], width, bottom=up['o'], color='#00ffcc')
        ax.bar(down.index, down['o'] - down['c'], width, bottom=down['c'], color='#ff00ff')

        if len(snapped_x) > 1:
            ax.plot(snapped_x, snapped_y, color='white', linewidth=2, linestyle='-', marker='o', markersize=6)
            
            for i, txt in enumerate(labels):
                y_offset = 15 if (i == 0 or snapped_y[i] >= snapped_y[i-1]) else -25
                ax.annotate(txt, (snapped_x[i], snapped_y[i]), 
                            textcoords="offset points", xytext=(0, y_offset), 
                            ha='center', color='yellow', fontsize=12, fontweight='bold')

        # 4. X-Achse manuell mit Datums-Strings beschriften
        num_ticks = 8
        if len(df) > 0:
            step = max(1, len(df) // num_ticks)
            tick_indices = list(range(0, len(df), step))
            tick_labels = [df.loc[i, 'd'].strftime('%Y-%m') for i in tick_indices]
            ax.set_xticks(tick_indices)
            ax.set_xticklabels(tick_labels, rotation=45)

        plt.title('Elliott-Wellen-Analyse (Integer X-Axis)', color='white', fontsize=14)
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
        
