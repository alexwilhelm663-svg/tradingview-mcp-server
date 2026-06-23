import sys
import json
import pandas as pd
import matplotlib.pyplot as plt
import io
import warnings

warnings.filterwarnings("ignore")

def main():
    try:
        input_data = sys.stdin.read()
        payload = json.loads(input_data)
        
        symbol = payload.get("symbol", "UNKNOWN").upper()
        waves = payload.get("waves", [])
        candles = payload.get("candles", [])
        
        if not candles or not waves:
            print("Missing candles or waves in JSON payload.", file=sys.stderr)
            sys.exit(1)
            
        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        
        for col in ['open', 'high', 'low', 'close']:
            df[col] = df[col].astype(float)
            
        plt.style.use('default')
        fig, ax = plt.subplots(figsize=(14, 7))
        
        ax.plot(df.index, df['close'], color='#1f2937', linewidth=1, zorder=2)
        
        for i in range(len(waves) - 1):
            w_curr = waves[i]
            w_next = waves[i+1]
            
            curr_date = pd.to_datetime(w_curr['date'])
            next_date = pd.to_datetime(w_next['date'])
            
            line_color = '#2563eb' # Standard: Bullen-Blau
            line_style = '-'
            is_correction = w_next['label'] in ['A', 'B', 'C']
            
            if is_correction:
                line_color = '#ef4444' # Alarm: Bären-Rot
                line_style = '--'
                
            ax.plot([curr_date, next_date], [w_curr['price'], w_next['price']], 
                     color=line_color, linestyle=line_style, linewidth=2, zorder=5)
            
            # Blaues Shading nur für die echten Impulswellen
            if not is_correction and w_next['label'] in ['1', '2', '3', '4', '5']:
                ax.fill_between([curr_date, next_date], 
                                [w_curr['price'], w_next['price']], 
                                df['low'].min() * 0.9, 
                                color='#2563eb', alpha=0.08, zorder=1)

            # Welle 0 zeichnen
            if i == 0:
                ax.scatter(curr_date, w_curr['price'], color='#2563eb', s=40, zorder=6)
                ax.annotate(w_curr['label'], (curr_date, w_curr['price']), 
                            xytext=(0, -15), textcoords='offset points', ha='center', 
                            color='#ea580c', fontweight='bold', fontsize=10)
            
            ax.scatter(next_date, w_next['price'], color=line_color, s=40, zorder=6)
            
            # --- DYNAMISCHES LABELING (Oben oder Unten?) ---
            # Prüft mathematisch, ob der aktuelle Punkt ein Tal oder ein Gipfel ist
            is_valley = w_next['price'] < w_curr['price']
            
            label_offset = -15 if is_valley else 10
            font_color = '#ea580c' if is_valley else line_color
            
            ax.annotate(w_next['label'], (next_date, w_next['price']), 
                         xytext=(0, label_offset), textcoords='offset points', ha='center', 
                         color=font_color, fontweight='bold', fontsize=10)
                         
        ax.set_yscale('log')
        ax.grid(True, which="major", ls="-", alpha=0.2)
        ax.grid(True, which="minor", ls=":", alpha=0.1)
        
        ax.set_title(f"{symbol} - Self-Healing EW Master", loc='left', fontweight='bold', fontsize=12)
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        
    except Exception as e:
        print(f"Python Render Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
