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
            sys.exit(1)
            
        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        for col in ['open', 'high', 'low', 'close']: df[col] = df[col].astype(float)
            
        plt.style.use('default')
        fig, ax = plt.subplots(figsize=(14, 7))
        ax.plot(df.index, df['close'], color='#1f2937', linewidth=1, zorder=2)
        
        is_correction_macro = any(w['label'] in ['A', 'B', 'C'] for w in waves)
        
        for i in range(len(waves) - 1):
            w_curr = waves[i]; w_next = waves[i+1]
            curr_date = pd.to_datetime(w_curr['date']); next_date = pd.to_datetime(w_next['date'])
            
            line_color = '#ef4444' if w_next['label'] in ['A', 'B', 'C'] else '#2563eb'
            line_style = '--' if w_next['label'] in ['A', 'B', 'C'] else '-'
                
            ax.plot([curr_date, next_date], [w_curr['price'], w_next['price']], color=line_color, linestyle=line_style, linewidth=2, zorder=5)
            
            if line_style == '-' and w_next['label'] in ['1', '2', '3', '4', '5']:
                ax.fill_between([curr_date, next_date], [w_curr['price'], w_next['price']], df['low'].min() * 0.9, color='#2563eb', alpha=0.08, zorder=1)

            if i == 0:
                ax.scatter(curr_date, w_curr['price'], color='#2563eb', s=40, zorder=6)
                ax.annotate(w_curr['label'], (curr_date, w_curr['price']), xytext=(0, -15), textcoords='offset points', ha='center', color='#ea580c', fontweight='bold', fontsize=10)
            
            ax.scatter(next_date, w_next['price'], color=line_color, s=40, zorder=6)
            is_valley = w_next['price'] < w_curr['price']
            ax.annotate(w_next['label'], (next_date, w_next['price']), xytext=(0, -15 if is_valley else 10), textcoords='offset points', ha='center', color='#ea580c' if is_valley else line_color, fontweight='bold', fontsize=10)
                         
        # TARGET MATRIX (V92)
        if len(waves) == 6 and not is_correction_macro:
            w0 = waves[0]['price']; w4 = waves[4]['price']; w5 = waves[5]['price']
            w5_date = pd.to_datetime(waves[5]['date']); end_date = df.index[-1]
            
            if w5_date < end_date:
                diff = w5 - w0
                f382 = w5 - (0.382 * diff); f500 = w5 - (0.500 * diff); f618 = w5 - (0.618 * diff)
                
                ax.hlines(y=f382, xmin=w5_date, xmax=end_date, colors='#f59e0b', linestyles=':', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.382', (end_date, f382), xytext=(5, 0), textcoords='offset points', color='#f59e0b', fontsize=8, va='center')
                ax.hlines(y=f500, xmin=w5_date, xmax=end_date, colors='#f59e0b', linestyles=':', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.500', (end_date, f500), xytext=(5, 0), textcoords='offset points', color='#f59e0b', fontsize=8, va='center')
                ax.hlines(y=f618, xmin=w5_date, xmax=end_date, colors='#ef4444', linestyles='--', linewidth=1.5, zorder=3)
                ax.annotate('Fib 0.618 (Golden Pocket)', (end_date, f618), xytext=(5, 0), textcoords='offset points', color='#ef4444', fontsize=8, va='center', fontweight='bold')
                
                ax.fill_between([w5_date, end_date], [w4]*2, [f618]*2, color='#ef4444', alpha=0.05, zorder=1)
                ax.annotate('Macro Kill-Zone', (w5_date + (end_date - w5_date)/2, (w4 + f618)/2), color='#ef4444', alpha=0.6, ha='center', va='center', fontsize=9, fontweight='bold')

        ax.set_yscale('log')
        ax.grid(True, which="major", ls="-", alpha=0.2)
        ax.grid(True, which="minor", ls=":", alpha=0.1)
        ax.set_title(f"{symbol} - Self-Healing EW Master", loc='left', fontweight='bold', fontsize=12)
        plt.subplots_adjust(right=0.9)
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
