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
    telemetry = []
    
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

        df = pd.DataFrame(candles)
        # Spaltennamen robust in Kleinbuchstaben umwandeln
        df.columns = [c.lower() for c in df.columns]
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)
        
        for col in ['open', 'high', 'low', 'close']:
            df[col] = df[col].astype(float)
        
        # 1. Startpunkt (Welle 0) ermitteln und Chart exakt am orthodoxen Boden abschneiden
        w0 = waves[0]
        w0_target = pd.to_datetime(w0['date'], errors='coerce')
        if pd.isna(w0_target) or df.empty: sys.exit(1)

        lbl0_upper = str(w0['label']).upper().strip()
        is_peak_start = True if lbl0_upper in ['1', '3', '5', 'I', 'III', 'V', 'B', 'TOP'] else False

        # Suchfenster für den Makro-Boden (±45 Tage)
        start_mask = (df.index >= (w0_target - timedelta(days=45))) & (df.index <= (w0_target + timedelta(days=45)))
        start_win = df[start_mask]
        
        if not start_win.empty:
            crop_date = start_win['high'].idxmax() if is_peak_start else start_win['low'].idxmin()
            snap_type = f"orthodox_macro_{'high' if is_peak_start else 'low'}_45d"
        else:
            idx = df.index.get_indexer([w0_target], method='nearest')[0]
            crop_date = df.index[idx]
            snap_type = "fallback_nearest_indexer"

        df = df.loc[crop_date:]
        if df.empty: sys.exit(1)

        wave_dates = [crop_date]
        wave_prices = [df.loc[crop_date, 'high' if is_peak_start else 'low']]
        wave_labels = [w0['label']]
        is_peak_list = [is_peak_start]

        telemetry.append({
            "step": "CHART_CROP (Wave 0)",
            "ai_date": str(w0['date']),
            "snapped_date": str(crop_date.date()),
            "price": float(wave_prices[0]),
            "method": snap_type
        })

        # =================================================================
        # 2. KAUSALES MONOTONIE-GESETZ (Streng vorwärtsgerichtetes Snapping)
        # =================================================================
        for i in range(1, len(waves)):
            w = waves[i]
            t_date = pd.to_datetime(w['date'], errors='coerce')
            if pd.isna(t_date): continue

            prev_date = wave_dates[-1]

            lbl_upper = str(w['label']).upper().strip()
            if lbl_upper in ['1', '3', '5', 'I', 'III', 'V', 'B', 'TOP']:
                is_peak = True
            elif lbl_upper in ['0', '2', '4', 'II', 'IV', 'A', 'C', 'START']:
                is_peak = False
            else:
                is_peak = w['price'] > wave_prices[-1]

            # KAUSALES GESETZ: Suchfenster startet zwingend erst am Tag NACH der Vorwelle!
            search_start = prev_date + timedelta(days=1)
            search_end = max(t_date + timedelta(days=20), search_start + timedelta(days=45))

            if search_start > df.index.max():
                search_start = df.index.max()

            mask = (df.index >= search_start) & (df.index <= search_end)
            win = df[mask]

            if not win.empty:
                # Peaks snappen orthodox an den höchsten Docht ('high'), Böden an den tiefsten Docht ('low')
                actual_date = win['high'].idxmax() if is_peak else win['low'].idxmin()
                price = win.loc[actual_date, 'high' if is_peak else 'low']
                m_used = "causal_forward_window_extrema"
            else:
                if search_start in df.index:
                    actual_date = search_start
                else:
                    idx = df.index.get_indexer([search_start], method='nearest')[0]
                    actual_date = df.index[idx]
                price = df.loc[actual_date, 'high' if is_peak else 'low']
                m_used = "causal_nearest_fallback"

            if isinstance(price, pd.Series): price = price.iloc[0]

            wave_dates.append(actual_date)
            wave_prices.append(float(price))
            wave_labels.append(w['label'])
            is_peak_list.append(is_peak)

            telemetry.append({
                "wave": w['label'],
                "ai_date": str(w['date']),
                "snapped_date": str(actual_date.date()),
                "price": float(price),
                "is_peak": is_peak,
                "search_window": f"{search_start.date()} to {search_end.date()}",
                "method": m_used
            })

        print(json.dumps({"telemetry_v2": telemetry}, indent=2), file=sys.stderr)

        # --- PLOT DASHBOARD (TradingView Dark Theme + LOG SCALE) ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#2B2D33', '#3B3E46', '#60646D'
        cyan, magenta, text_color = '#00BFA5', '#D81B60', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        
        ax.set_yscale('log')
        
        # Plot Close-Linie
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        # Plot Vektor-Verbindungen der echten Docht-Extrema
        if len(wave_dates) > 1:
            ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2, linestyle='-', marker='o', markersize=12, label='Elliott Wave Impuls')
            
        for date, price, label, is_p in zip(wave_dates, wave_prices, wave_labels, is_peak_list):
            xytext = (0, 18) if is_p else (0, -18)
            va = 'bottom' if is_p else 'top'
            ax.annotate(
                label,
                xy=(date, price),
                xytext=xytext,
                textcoords='offset points',
                color=magenta,
                fontsize=24,
                fontweight='bold',
                ha='center',
                va=va
            )
            
        ax.grid(True, which='both', color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values(): spine.set_color(spine_color)
        ax.tick_params(axis='both', which='both', colors=text_color, labelsize=11, color=spine_color)
        
        ax.set_xlim(df.index.min() - timedelta(days=10), df.index.max() + timedelta(days=10))
            
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')))
        
        fig.text(0.5, 0.92, f"{symbol} - ", color='white', fontsize=22, ha='right', va='center')
        fig.text(0.5, 0.92, "Elliott-Wellen-Analyse (Log-Scale)", color=cyan, fontsize=22, ha='left', va='center')
        
        legend = ax.legend(loc='upper left', facecolor=bg_color, edgecolor=grid_color, fontsize=11)
        for t in legend.get_texts(): t.set_color('white')
            
        plt.subplots_adjust(top=0.85, bottom=0.1, left=0.08, right=0.95)
        
        buf = io.BytesIO()
        fig.savefig(buf, format='png', dpi=150, facecolor=bg_color, edgecolor='none')
        buf.seek(0)
        sys.stdout.buffer.write(buf.getvalue())
        sys.stdout.flush()
        
    except Exception as e:
        print(json.dumps({"error": traceback.format_exc()}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
            
