    
import sys
import json
import io
import traceback
import pandas as pd
import matplotlib
matplotlib.use('Agg') # Headless Mode
import mplfinance as mpf

def main():
    try:
        json_str = sys.stdin.read()
        if not json_str:
            print("Error: Leerer Datenstrom von Node.js", file=sys.stderr)
            sys.exit(1)
            
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])

        if not candles:
            print("Error: Keine Kerzendaten zum Zeichnen erhalten.", file=sys.stderr)
            sys.exit(1)

        # Konvertiere in DataFrame
        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True) # FIX: Zwingt die Daten in die richtige Reihenfolge

        df['Open'] = df['open'].astype(float)
        df['High'] = df['high'].astype(float)
        df['Low'] = df['low'].astype(float)
        df['Close'] = df['close'].astype(float)

        wave_dates = []
        wave_prices = []
        wave_labels = []

        for w in waves:
            w_date = pd.to_datetime(w['date'])
            if w_date in df.index:
                target_date = w_date
            else:
                if len(df.index) > 0:
                    idx = df.index.get_indexer([w_date], method='nearest')[0]
                    target_date = df.index[idx]
                else:
                    continue
            
            price = df.loc[target_date, 'High'] if w['label'] in ['2', '4', 'B', 'II', 'IV', 'X'] else df.loc[target_date, 'Low']
            
            # FIX: Falls es doppelte Tage gibt, nimm nur den ersten Preis
            if isinstance(price, pd.Series):
                price = price.iloc[0]
                
            wave_dates.append(target_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])

        lines = []
        if len(wave_dates) > 1:
            line_points = list(zip(wave_dates, wave_prices))
            lines.append(line_points)

        mc = mpf.make_marketcolors(up='#26a69a', down='#ef5350', edge='inherit', wick='inherit')
        s = mpf.make_mpf_style(marketcolors=mc, base_mpf_style='nightclouds')

        kwargs = dict(
            type='candle', 
            style=s, 
            returnfig=True,
            figsize=(10, 6)
        )
        
        if lines:
            kwargs['alines'] = dict(alines=lines, colors=['#00bcd4'], linewidths=1.5)

        fig, axes = mpf.plot(df, **kwargs)

        ax = axes[0]
        
        for date, price, label in zip(wave_dates, wave_prices, wave_labels):
            offset = (df['High'].max() - df['Low'].min()) * 0.02
            y_pos = price + offset if label in ['2', '4', 'B', 'II', 'IV', 'X'] else price - offset
            ax.text(date, y_pos, label, color='white', fontsize=10, ha='center', va='center',
                    bbox=dict(facecolor='#333333', edgecolor='#00bcd4', boxstyle='round,pad=0.3', alpha=0.8))

        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.flush()
        
    except Exception as e:
        # SENDET DEN EXAKTEN FEHLER AN DEN BOT ZURÜCK
        print(f"Python Crash Log:\n{traceback.format_exc()}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
    
