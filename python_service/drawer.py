import sys
import json
import io
import pandas as pd
import matplotlib
matplotlib.use('Agg') # <-- DER MAGISCHE CLOUD-FIX (Headless Mode ohne Monitor)
import mplfinance as mpf
import matplotlib.pyplot as plt

def main():
    try:
        # Lese Daten aus dem unendlichen stdin-Stream
        json_str = sys.stdin.read()
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
    except Exception as e:
        sys.exit(1)

    if not candles:
        sys.exit(1)

    try:
        # Konvertiere in DataFrame
        df = pd.DataFrame(candles)
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df['Open'] = df['open'].astype(float)
        df['High'] = df['high'].astype(float)
        df['Low'] = df['low'].astype(float)
        df['Close'] = df['close'].astype(float)

        # Extrahiere Wellen-Punkte für den Vektor-Plot
        wave_dates = []
        wave_prices = []
        wave_labels = []

        for w in waves:
            w_date = pd.to_datetime(w['date'])
            # Finde das naheliegendste Datum im Index
            if w_date in df.index:
                target_date = w_date
            else:
                if len(df.index) > 0:
                    idx = df.index.get_indexer([w_date], method='nearest')[0]
                    target_date = df.index[idx]
                else:
                    continue
            
            # Lege den Punkt ans High oder Low
            price = df.loc[target_date, 'High'] if w['label'] in ['2', '4', 'B', 'II', 'IV', 'X'] else df.loc[target_date, 'Low']
            
            wave_dates.append(target_date)
            wave_prices.append(price)
            wave_labels.append(w['label'])

        # Erstelle Alines für mplfinance
        lines = []
        if len(wave_dates) > 1:
            line_points = list(zip(wave_dates, wave_prices))
            lines.append(line_points)

        # Erstelle das Plot-Setup
        mc = mpf.make_marketcolors(up='#26a69a', down='#ef5350', edge='inherit', wick='inherit')
        s = mpf.make_mpf_style(marketcolors=mc, base_mpf_style='nightclouds')

        kwargs = dict(
            type='candle', 
            style=s, 
            returnfig=True,
            figsize=(10, 6)
        )
        
        # Nur zeichnen, wenn es auch Linien gibt
        if lines:
            kwargs['alines'] = dict(alines=lines, colors=['#00bcd4'], linewidths=1.5)

        fig, axes = mpf.plot(df, **kwargs)

        ax = axes[0]
        
        # Text-Labels für die Wellen anbringen
        for date, price, label in zip(wave_dates, wave_prices, wave_labels):
            offset = (df['High'].max() - df['Low'].min()) * 0.02
            y_pos = price + offset if label in ['2', '4', 'B', 'II', 'IV', 'X'] else price - offset
            ax.text(date, y_pos, label, color='white', fontsize=10, ha='center', va='center',
                    bbox=dict(facecolor='#333333', edgecolor='#00bcd4', boxstyle='round,pad=0.3', alpha=0.8))

        # Bild im Speicher speichern und an Node.js übergeben
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=150)
        buf.seek(0)
        
        # Raw Bytes in den stdout schreiben
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.flush()
        
    except Exception as e:
        sys.exit(1)

if __name__ == "__main__":
    main()
    
