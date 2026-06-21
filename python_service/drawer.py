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
        
        # Rollen-Katalog (Impuls-Gipfel vs Korrektur-Täler)
        peak_labels = ['1', '3', '5', 'I', 'III', 'V', 'B', 'TOP', 'WAVE 1', 'WAVE 3', 'WAVE 5', 'WAVE B']
        
        snapped_waves = []
        for w in waves:
            snapped_waves.append({
                'label': w['label'],
                'raw_label': str(w['label']).upper().strip(),
                'ai_date': pd.to_datetime(w['date'], errors='coerce'),
                'is_peak': str(w['label']).upper().strip() in peak_labels,
                'date': None,
                'price': None
            })

        # =========================================================================
        # TOPOLOGICAL TWO-PASS SNAPPING (Master Extrema Relaxation)
        # =========================================================================
        # --- PASS 1: ALLE TÄLER FEST VERANKERN (0, 2, 4, A, C) ---
        last_trough_date = df.index.min()
        
        for sw in snapped_waves:
            if not sw['is_peak']:
                t_date = sw['ai_date']
                if pd.isna(t_date): t_date = last_trough_date + timedelta(days=30)
                
                # Suchfenster für Täler: ±40 Tage um KI-Datum, aber zwingend nach dem letzten Tal
                win_start = max(last_trough_date + timedelta(days=7), t_date - timedelta(days=40))
                win_end = max(win_start + timedelta(days=14), t_date + timedelta(days=40))
                
                if win_start > df.index.max(): win_start = df.index.max()
                
                mask = (df.index >= win_start) & (df.index <= win_end)
                win = df[mask]
                
                if not win.empty:
                    actual_date = win['low'].idxmin()
                else:
                    actual_date = win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]]
                
                sw['date'] = actual_date
                sw['price'] = float(df.loc[actual_date, 'low'])
                last_trough_date = actual_date

        # --- PASS 2: ALLE GIPFEL ZWINGEND ZWISCHEN DEN TÄLERN AUFSPANNEN ---
        for i, sw in enumerate(snapped_waves):
            if sw['is_peak']:
                # Finde das direkt vorangegangene Tal
                prev_trough_date = df.index.min()
                for j in range(i-1, -1, -1):
                    if not snapped_waves[j]['is_peak'] and snapped_waves[j]['date'] is not None:
                        prev_trough_date = snapped_waves[j]['date']
                        break
                
                # Finde das direkt nachfolgende Tal
                next_trough_date = df.index.max()
                for j in range(i+1, len(snapped_waves)):
                    if not snapped_waves[j]['is_peak'] and snapped_waves[j]['date'] is not None:
                        next_trough_date = snapped_waves[j]['date']
                        break
                
                # Das Suchfenster ist exakt der Raum zwischen den beiden Tälern!
                win_start = prev_trough_date + timedelta(days=1)
                win_end = next_trough_date - timedelta(days=1)
                
                if win_end <= win_start:
                    win_end = win_start + timedelta(days=7)
                
                if win_start > df.index.max(): win_start = df.index.max()
                
                mask = (df.index >= win_start) & (df.index <= win_end)
                win = df[mask]
                
                if not win.empty:
                    actual_date = win['high'].idxmax()
                else:
                    actual_date = win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]]
                
                sw['date'] = actual_date
                sw['price'] = float(df.loc[actual_date, 'high'])

        # 1 Jahr historischer Kontext-Vorlauf vor Welle 0
        w0_date = snapped_waves[0]['date']
        context_start = w0_date - timedelta(days=365)
        if context_start < df.index.min(): context_start = df.index.min()
        df = df.loc[context_start:]
        if df.empty: sys.exit(1)

        # Extrahierte Vektor-Listen für Matplotlib
        wave_dates = [sw['date'] for sw in snapped_waves]
        wave_prices = [sw['price'] for sw in snapped_waves]
        wave_labels = [sw['label'] for sw in snapped_waves]
        is_peak_list = [sw['is_peak'] for sw in snapped_waves]
        raw_labels = [sw['raw_label'] for sw in snapped_waves]

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

        # --- PLOT DASHBOARD (TradingView Dark Theme + LOG SCALE) ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#2B2D33', '#3B3E46', '#60646D'
        cyan, magenta, orange, text_color = '#00BFA5', '#D81B60', '#FF9800', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.set_yscale('log')
        
        ax.plot(df.index, df['close'], color=cyan, linewidth=2, label='Close Price')
        
        if len(wave_dates) > 1:
            try:
                idx_5 = raw_labels.index('5')
                ax.plot(wave_dates[:idx_5+1], wave_prices[:idx_5+1], color=magenta, linewidth=2.5, linestyle='-', marker='o', markersize=11, label='Motive Waves (1-5)')
                
                if len(wave_dates) > idx_5:
                    if 'B' in raw_labels and not c_is_confirmed:
                        idx_b = raw_labels.index('B')
                        ax.plot(wave_dates[idx_5:idx_b+1], wave_prices[idx_5:idx_b+1], color=orange, linewidth=2.5, linestyle='--', marker='o', markersize=11)
                        ax.plot(wave_dates[idx_b:], wave_prices[idx_b:], color='#FFCC80', linewidth=2.0, linestyle=':', marker='o', markersize=10, alpha=0.85)
                        
                        if fib_161_target and fib_061_target:
                            ax.axhspan(ymin=fib_161_target, ymax=fib_061_target, facecolor='#00BFA5', alpha=0.15, label='🎯 Fib Target Cluster')
                            ax.hlines(y=fib_100_target, xmin=date_b_gate, xmax=last_date + timedelta(days=35), color='#00BFA5', linestyle=':', linewidth=1.8)
                            ax.annotate(
                                f"🎯 FIB TARGET 1.00 ({fib_100_target:,.2f} USD)",
                                xy=(last_date, fib_100_target), xytext=(0, 6), textcoords='offset points', color='#00BFA5', fontsize=11, fontweight='bold', ha='right', va='bottom'
                            )
                        
                        ax.hlines(y=price_b_gate, xmin=date_b_gate, xmax=last_date + timedelta(days=35), color='#E53935', linestyle='-.', linewidth=1.5)
                        
                        checklist_text = (
                            "🔒 KORREKTUR-ABSCHLUSS CHECKLISTE:\n"
                            " [ ] Stufe 1: Impulsiver 5-Teiler (i-v) nach oben\n"
                            " [ ] Stufe 2: Dreiteiliger Pullback (a-b-c) bildet höheres Tief\n"
                            f" [{'x' if c_is_confirmed else ' '}] Stufe 3: Schlusskurs bricht B-Gate ({price_b_gate:,.2f} USD)"
                        )
                        ax.text(
                            0.96, 0.06, checklist_text, transform=ax.transAxes, facecolor='#1E1F22', edgecolor=orange if not c_is_confirmed else cyan,
                            color='white', fontsize=11, fontweight='bold', ha='right', va='bottom', bbox=dict(boxstyle='round,pad=0.6', facecolor='#1E1F22', edgecolor=orange if not c_is_confirmed else cyan, alpha=0.9)
                        )
                    else:
                        ax.plot(wave_dates[idx_5:], wave_prices[idx_5:], color=orange, linewidth=2.5, linestyle='--', marker='o', markersize=11)
            except ValueError:
                ax.plot(wave_dates, wave_prices, color=magenta, linewidth=2.5, linestyle='-', marker='o', markersize=11)

        for date, price, label, is_p in zip(wave_dates, wave_prices, wave_labels, is_peak_list):
            xytext = (0, 18) if is_p else (0, -18)
            va = 'bottom' if is_p else 'top'
            
            if "( ? )" in label: lbl_color = '#FFD54F'
            elif label.upper() in ['A', 'B', 'C', 'W', 'X', 'Y']: lbl_color = orange
            else: lbl_color = magenta
            
            ax.annotate(label, xy=(date, price), xytext=xytext, textcoords='offset points', color=lbl_color, fontsize=24, fontweight='bold', ha='center', va=va)
            
        ax.grid(True, which='both', color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values(): spine.set_color(spine_color)
        ax.tick_params(axis='both', which='both', colors=text_color, labelsize=11, color=spine_color)
        
        ax.set_xlim(df.index.min() - timedelta(days=15), df.index.max() + timedelta(days=35))
            
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')))
        
        fig.text(0.5, 0.92, f"{symbol} - ", color='white', fontsize=22, ha='right', va='center')
        if not c_is_confirmed and price_b_gate:
            fig.text(0.5, 0.92, "Korrektur Aktiv [Boden C unbestätigt]", color='#FF9800', fontsize=22, ha='left', va='center', fontweight='bold')
        else:
            fig.text(0.5, 0.92, "Elliott-Wellen Superzyklus", color=cyan, fontsize=22, ha='left', va='center')
        
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
    
