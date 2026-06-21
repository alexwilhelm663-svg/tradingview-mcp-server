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
    try:
        json_str = sys.stdin.read()
        if not json_str: sys.exit(1)
            
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
        symbol = data.get("symbol", "Symbol")

        if not candles or not waves: sys.exit(1)

        df = pd.DataFrame(candles)
        df.columns = [c.lower() for c in df.columns]
        df['date'] = pd.to_datetime(df['date'])
        df.set_index('date', inplace=True)
        df.sort_index(inplace=True)
        
        for col in ['open', 'high', 'low', 'close']:
            df[col] = df[col].astype(float)
        
        # 1. Startpunkt (Welle 0 Boden) verankern
        w0 = waves[0]
        w0_target = pd.to_datetime(w0['date'], errors='coerce')
        if pd.isna(w0_target) or df.empty: sys.exit(1)

        start_mask = (df.index >= (w0_target - timedelta(days=45))) & (df.index <= (w0_target + timedelta(days=45)))
        start_win = df[start_mask]
        
        crop_date = start_win['low'].idxmin() if not start_win.empty else df.index[df.index.get_indexer([w0_target], method='nearest')[0]]

        # 1 Jahr Vorlauf auf der X-Achse
        context_start = crop_date - timedelta(days=365)
        if context_start < df.index.min(): context_start = df.index.min()
        df = df.loc[context_start:]
        if df.empty: sys.exit(1)

        wave_dates = [crop_date]
        wave_prices = [df.loc[crop_date, 'low']]
        wave_labels = [w0['label']]
        is_peak_list = [False]

        raw_labels = [str(w['label']).upper().strip() for w in waves]

        # =========================================================================
        # 2. MIDPOINT-FORWARD HORIZON (Die absolute Extrema-Falle)
        # =========================================================================
        for i in range(1, len(waves)):
            w = waves[i]
            t_date = pd.to_datetime(w['date'], errors='coerce')
            if pd.isna(t_date): continue

            prev_locked_date = wave_dates[-1]
            lbl_upper = raw_labels[i]

            # Rollenregister
            if lbl_upper in ['1', '3', '5', 'I', 'III', 'V', 'B', 'TOP']:
                is_peak = True
            elif lbl_upper in ['0', '2', '4', 'II', 'IV', 'A', 'C', 'START']:
                is_peak = False
            else:
                is_peak = w['price'] > wave_prices[-1]

            # DIE LINKE WAND: Exakt 1 Tag nach dem echten Vorgänger-Boden/Gipfel!
            win_start = prev_locked_date + timedelta(days=1)

            # DIE RECHTE WAND: Berechnung des "Midpoint Horizons"
            if i < len(waves) - 2:
                # Wir haben eine Gegenwelle (i+1) und die nächste Welle derselben Richtung (i+2)
                t_next_opp = pd.to_datetime(waves[i+1]['date'], errors='coerce')
                t_next_same = pd.to_datetime(waves[i+2]['date'], errors='coerce')
                
                if not pd.isna(t_next_opp) and not pd.isna(t_next_same) and t_next_same > t_next_opp:
                    # Goldene Mitte zwischen Trough 4 und Peak 5!
                    half_delta = (t_next_same - t_next_opp) / 2
                    win_end = t_next_opp + half_delta
                elif not pd.isna(t_next_opp):
                    win_end = t_next_opp + timedelta(days=25)
                else:
                    win_end = win_start + timedelta(days=90)
            elif i < len(waves) - 1:
                t_next = pd.to_datetime(waves[i+1]['date'], errors='coerce')
                win_end = t_next + timedelta(days=25) if not pd.isna(t_next) else win_start + timedelta(days=90)
            else:
                win_end = df.index.max()

            if win_start > df.index.max(): win_start = df.index.max()
            if win_end > df.index.max(): win_end = df.index.max()
            if win_end < win_start: win_end = win_start + timedelta(days=14)

            mask = (df.index >= win_start) & (df.index <= win_end)
            win = df[mask]

            if not win.empty:
                # Sucht das absolute Docht-Extrem im mathematisch abgeriegelten Canyon
                actual_date = win['high'].idxmax() if is_peak else win['low'].idxmin()
                price = win.loc[actual_date, 'high' if is_peak else 'low']
            else:
                actual_date = win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]]
                price = df.loc[actual_date, 'high' if is_peak else 'low']

            if isinstance(price, pd.Series): price = price.iloc[0]

            wave_dates.append(actual_date)
            wave_prices.append(float(price))
            wave_labels.append(w['label'])
            is_peak_list.append(is_peak)

        # --- 3. QUANT FIBONACCI ENGINE & DEMUTS-SCHRANKE (B-Gate) ---
        c_is_confirmed = True
        price_b_gate = None
        date_b_gate = None
        last_close = df['close'].iloc[-1]
        last_date = df.index.max()

        fib_100_target = None
        fib_061_target = None
        fib_161_target = None

        if 'C' in raw_labels and 'B' in raw_labels and 'A' in raw_labels and '5' in raw_labels:
            idx_5 = raw_labels.index('5')
            idx_a = raw_labels.index('A')
            idx_b = raw_labels.index('B')
            idx_c = raw_labels.index('C')

            p5 = wave_prices[idx_5]
            pa = wave_prices[idx_a]
            pb = wave_prices[idx_b]
            date_b_gate = wave_dates[idx_b]
            price_b_gate = pb

            if last_close < pb:
                c_is_confirmed = False
                wave_labels[idx_c] = "C ( ? )"

                # Log-geometrische Projektion
                ratio_a = pa / p5 if p5 > 0 else 0.7
                fib_061_target = pb * (ratio_a ** 0.618)
                fib_100_target = pb * (ratio_a ** 1.000)
                fib_161_target = pb * (ratio_a ** 1.618)

                wave_dates[idx_c] = last_date + timedelta(days=14)
                wave_prices[idx_c] = fib_100_target

        print(json.dumps({
            "correction_gate": {
                "b_gate_price": price_b_gate if price_b_gate else 0,
                "current_close": float(last_close),
                "is_confirmed": c_is_confirmed
            }
        }), file=sys.stderr)

        # --- PLOT DASHBOARD (TradingView Charcoal Deep Dark) ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        # Echte TradingView Farb-Palette
        bg_color, grid_color, spine_color = '#131722', '#2A2E39', '#363C4E'
        cyan, magenta, orange, text_color = '#00BFA5', '#D81B60', '#FF9800', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.set_yscale('log')
        
        # =========================================================================
        # DER WICK-CHANNEL: Zeigt die Dochte hinter dem Schlusskurs-Strich
        # =========================================================================
        ax.plot(df.index, df['high'], color='#787B86', linewidth=0.8, linestyle=':', alpha=0.35, label='High / Low Wicks')
        ax.plot(df.index, df['low'], color='#787B86', linewidth=0.8, linestyle=':', alpha=0.35)
        ax.plot(df.index, df['close'], color=cyan, linewidth=2.2, label='Close Price')
        
        if len(wave_dates) > 1:
            try:
                idx_5 = raw_labels.index('5')
                # Impuls mit Leucht-Ring um die Eckpunkte
                ax.plot(wave_dates[:idx_5+1], wave_prices[:idx_5+1], color=magenta, linewidth=2.5, linestyle='-', marker='o', markersize=10, label='Motive Waves (1-5)')
                ax.plot(wave_dates[:idx_5+1], wave_prices[:idx_5+1], color=magenta, linewidth=0, marker='o', markersize=18, alpha=0.25)
                
                if len(wave_dates) > idx_5:
                    if 'B' in raw_labels and not c_is_confirmed:
                        idx_b = raw_labels.index('B')
                        ax.plot(wave_dates[idx_5:idx_b+1], wave_prices[idx_5:idx_b+1], color=orange, linewidth=2.5, linestyle='--', marker='o', markersize=10, label='Corrective Waves (A-B)')
                        ax.plot(wave_dates[idx_b:], wave_prices[idx_b:], color='#FFCC80', linewidth=2.0, linestyle=':', marker='o', markersize=9, alpha=0.9)
                        
                        if fib_161_target and fib_061_target:
                            ax.axhspan(ymin=fib_161_target, ymax=fib_061_target, facecolor='#00BFA5', alpha=0.12, label='🎯 Fib Target Cluster')
                            ax.hlines(y=fib_100_target, xmin=date_b_gate, xmax=last_date + timedelta(days=35), color='#00BFA5', linestyle=':', linewidth=1.8)
                            ax.annotate(f"🎯 FIB TARGET 1.00 ({fib_100_target:,.2f} USD)", xy=(last_date, fib_100_target), xytext=(0, 6), textcoords='offset points', color='#00BFA5', fontsize=11, fontweight='bold', ha='right', va='bottom')
                        
                        ax.hlines(y=price_b_gate, xmin=date_b_gate, xmax=last_date + timedelta(days=35), color='#E53935', linestyle='-.', linewidth=1.5)
                        
                        checklist = (
                            "🔒 KORREKTUR-ABSCHLUSS CHECKLISTE:\n"
                            " [ ] Stufe 1: Impulsiver 5-Teiler (i-v) nach oben\n"
                            " [ ] Stufe 2: Dreiteiliger Pullback (a-b-c) bildet höheres Tief\n"
                            f" [{'x' if c_is_confirmed else ' '}] Stufe 3: Schlusskurs bricht B-Gate ({price_b_gate:,.2f} USD)"
                        )
                        ax.text(0.96, 0.06, checklist, transform=ax.transAxes, facecolor='#1E222D', edgecolor=orange if not c_is_confirmed else cyan, color='white', fontsize=11, fontweight='bold', ha='right', va='bottom', bbox=dict(boxstyle='round,pad=0.6', facecolor='#1E222D', edgecolor=orange if not c_is_confirmed else cyan, alpha=0.95))
                    else:
                        ax.plot(wave_dates[idx_5:], wave_prices[idx_5:], color=orange, linewidth=2.5, linestyle='--', marker='o', markersize=10, label='Corrective Waves (A-B-C)')
            except ValueError:
                ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2.5, linestyle='-', marker='o', markersize=10)

        # Smarte, kollisionsfreie Text-Positionierung
        for date, price, label, is_p in zip(wave_dates, wave_prices, wave_labels, is_peak_list):
            xytext = (0, 16) if is_p else (0, -22)
            va = 'bottom' if is_p else 'top'
            
            if "( ? )" in label: lbl_color = '#FFD54F'
            elif label.upper() in ['A', 'B', 'C', 'W', 'X', 'Y']: lbl_color = orange
            else: lbl_color = magenta
            
            ax.annotate(label, xy=(date, price), xytext=xytext, textcoords='offset points', color=lbl_color, fontsize=22, fontweight='heavy', ha='center', va=va)
            
        ax.grid(True, which='both', color=grid_color, linestyle='--', linewidth=0.6)
        ax.set_axisbelow(True)
        
        # Rahmen ausblenden bis auf X-Boden
        for side in ['top', 'left']: ax.spines[side].set_visible(False)
        for side in ['bottom', 'right']: ax.spines[side].set_color(spine_color)
        
        ax.tick_params(axis='both', which='both', colors=text_color, labelsize=11, color=spine_color)
        ax.yaxis.tick_right() # Profi-Look: Preisachse nach rechts
        
        ax.set_xlim(df.index.min() - timedelta(days=15), df.index.max() + timedelta(days=35))
            
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')))
        
        fig.text(0.05, 0.92, f"{symbol} - ", color='white', fontsize=24, ha='left', va='center', fontweight='bold')
        if not c_is_confirmed and price_b_gate:
            fig.text(0.18, 0.92, "Korrektur Aktiv [Boden C unbestätigt]", color='#FF9800', fontsize=22, ha='left', va='center', fontweight='bold')
        else:
            fig.text(0.18, 0.92, "Elliott-Wellen Superzyklus", color=cyan, fontsize=22, ha='left', va='center')
        
        plt.subplots_adjust(top=0.85, bottom=0.1, left=0.05, right=0.88)
        
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
    
