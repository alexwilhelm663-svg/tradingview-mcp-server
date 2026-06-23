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
        
        is_correction_macro = any(w['label'] in ['A', 'B', 'C'] for w in waves)
        
        for i in range(len(waves) - 1):
            w_curr = waves[i]
            w_next = waves[i+1]
            
            curr_date = pd.to_datetime(w_curr['date'])
            next_date = pd.to_datetime(w_next['date'])
            
            line_color = '#2563eb' # Standard: Bullen-Blau
            line_style = '-'
            is_correction_wave = w_next['label'] in ['A', 'B', 'C']
            
            if is_correction_wave:
                line_color = '#ef4444' # Alarm: Bären-Rot
                line_style = '--'
                
            ax.plot([curr_date, next_date], [w_curr['price'], w_next['price']], 
                     color=line_color, linestyle=line_style, linewidth=2, zorder=5)
            
            # Blaues Shading nur für die echten Impulswellen
            if not is_correction_wave and w_next['label'] in ['1', '2', '3', '4', '5']:
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
            
            # Dynamisches Labeling (Oben oder Unten)
            is_valley = w_next['price'] < w_curr['price']
            label_offset = -15 if is_valley else 10
            font_color = '#ea580c' if is_valley else line_color
            
            ax.annotate(w_next['label'], (next_date, w_next['price']), 
                         xytext=(0, label_offset), textcoords='offset points', ha='center', 
                         color=font_color, fontweight='bold', fontsize=10)
                         
        # =========================================================================
        # 🔥 NEU V92: DIE TARGET MATRIX (FIBONACCI & KILL-ZONE)
        # =========================================================================
        # Wird nur gezeichnet, wenn es ein kompletter 1-5 Bullenmarkt ohne A-B-C ist
        if len(waves) == 6 and not is_correction_macro:
            w0_price = waves[0]['price']
            w4_price = waves[4]['price']
            w5_price = waves[5]['price']
            w5_date = pd.to_datetime(waves[5]['date'])
            end_date = df.index[-1]
            
            # Wenn noch Platz im Chart nach rechts ist (Welle 5 ist nicht die aktuellste Kerze)
            if w5_date < end_date:
                diff = w5_price - w0_price
                
                # Standard Fibonacci Retracements berechnen
                fib_382 = w5_price - (0.382 * diff)
                fib_500 = w5_price - (0.500 * diff)
                fib_618 = w5_price - (0.618 * diff)
                
                # Linien ab dem Top der Welle 5 in die Zukunft ziehen
                ax.hlines(y=fib_382, xmin=w5_date, xmax=end_date, colors='#f59e0b', linestyles=':', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.382', (end_date, fib_382), xytext=(5, 0), textcoords='offset points', color='#f59e0b', fontsize=8, va='center')
                
                ax.hlines(y=fib_500, xmin=w5_date, xmax=end_date, colors='#f59e0b', linestyles=':', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.500', (end_date, fib_500), xytext=(5, 0), textcoords='offset points', color='#f59e0b', fontsize=8, va='center')
                
                ax.hlines(y=fib_618, xmin=w5_date, xmax=end_date, colors='#ef4444', linestyles='--', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.618 (Golden Pocket)', (end_date, fib_618), xytext=(5, 0), textcoords='offset points', color='#ef4444', fontsize=8, va='center', fontweight='bold')
                
                # Die "Kill-Zone" zwischen Welle 4 und dem 61.8er Fib rot markieren
                ax.fill_between([w5_date, end_date], [w4_price]*2, [fib_618]*2, color='#ef4444', alpha=0.05, zorder=1)
                
                # Ein kleines Label mitten in die Kill-Zone packen
                mid_date = w5_date + (end_date - w5_date) / 2
                mid_price = (w4_price + fib_618) / 2
                ax.annotate('Macro Kill-Zone', (mid_date, mid_price), color='#ef4444', alpha=0.6, ha='center', va='center', fontsize=9, fontweight='bold')

        # =========================================================================

        ax.set_yscale('log')
        ax.grid(True, which="major", ls="-", alpha=0.2)
        ax.grid(True, which="minor", ls=":", alpha=0.1)
        
        ax.set_title(f"{symbol} - Self-Healing EW Master", loc='left', fontweight='bold', fontsize=12)
        
        # Den Rand nach rechts etwas erweitern, damit die Fibonacci-Texte Platz haben
        plt.subplots_adjust(right=0.9)
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        
    except Exception as e:
        print(f"Python Render Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
