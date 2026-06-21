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
        
        # Umfassendes Rollen-Register für Extrema-Relaxation
        peak_roles = ['1', '3', '5', 'B', '(1)', '(3)', '(5)', '(B)', 'I', 'III', 'V', 'X']
        trough_roles = ['0', '2', '4', 'A', 'C', '(2)', '(4)', '(A)', '(C)', 'II', 'IV', 'W', 'Y', 'Z']
        
        snapped_waves = []
        for w in waves:
            raw_upper = str(w['label']).upper().strip()
            # Falls Label nicht in Trough-Liste, default zu Peak
            is_pk = True if raw_upper in peak_roles else (False if raw_upper in trough_roles else True)
            
            snapped_waves.append({
                'label': w['label'],
                'raw_label': raw_upper,
                'ai_date': pd.to_datetime(w['date'], errors='coerce'),
                'is_peak': is_pk,
                'date': None,
                'price': None
            })

        # =========================================================================
        # TOPOLOGICAL TWO-PASS SNAPPING (Löst N-Wellen lückenlos)
        # =========================================================================
        # --- PASS 1: ALLE TÄLER VERANKERN ---
        last_trough_date = df.index.min()
        for sw in snapped_waves:
            if not sw['is_peak']:
                t_date = sw['ai_date']
                if pd.isna(t_date): t_date = last_trough_date + timedelta(days=30)
                
                win_start = max(last_trough_date + timedelta(days=7), t_date - timedelta(days=40))
                win_end = max(win_start + timedelta(days=14), t_date + timedelta(days=40))
                if win_start > df.index.max(): win_start = df.index.max()
                
                mask = (df.index >= win_start) & (df.index <= win_end)
                win = df[mask]
                actual_date = win['low'].idxmin() if not win.empty else (win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]])
                
                sw['date'] = actual_date
                sw['price'] = float(df.loc[actual_date, 'low'])
                last_trough_date = actual_date

        # --- PASS 2: ALLE GIPFEL ZWISCHEN DEN TÄLERN EINSPANNEN ---
        for i, sw in enumerate(snapped_waves):
            if sw['is_peak']:
                prev_trough_date = df.index.min()
                for j in range(i-1, -1, -1):
                    if not snapped_waves[j]['is_peak'] and snapped_waves[j]['date'] is not None:
                        prev_trough_date = snapped_waves[j]['date']
                        break
                
                next_trough_date = df.index.max()
                for j in range(i+1, len(snapped_waves)):
                    if not snapped_waves[j]['is_peak'] and snapped_waves[j]['date'] is not None:
                        next_trough_date = snapped_waves[j]['date']
                        break
                
                win_start = prev_trough_date + timedelta(days=1)
                win_end = next_trough_date - timedelta(days=1)
                if win_end <= win_start: win_end = win_start + timedelta(days=7)
                if win_start > df.index.max(): win_start = df.index.max()
                
                mask = (df.index >= win_start) & (df.index <= win_end)
                win = df[mask]
                actual_date = win['high'].idxmax() if not win.empty else (win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]])
                
                sw['date'] = actual_date
                sw['price'] = float(df.loc[actual_date, 'high'])

        # Vorlauf X-Achse
        w0_date = snapped_waves[0]['date']
        context_start = w0_date - timedelta(days=365)
        if context_start < df.index.min(): context_start = df.index.min()
        df = df.loc[context_start:]
        if df.empty: sys.exit(1)

        # --- B-GATE PRÜFUNG FÜR DAS ALLERLETZTE KORREKTUR-TAL ---
        c_is_confirmed = True
        price_b_gate = None
        last_close = df['close'].iloc[-1]

        # Sucht das letzte 'B' oder '(B)' im Stream
        b_candidates = [sw for sw in snapped_waves if sw['raw_label'] in ['B', '(B)']]
        if b_candidates:
            last_b = b_candidates[-1]
            price_b_gate = last_b['price']
            if last_close < price_b_gate:
                c_is_confirmed = False

        print(json.dumps({
            "correction_gate": {
                "b_gate_price": price_b_gate if price_b_gate else 0,
                "current_close": float(last_close),
                "is_confirmed": c_is_confirmed
            }
        }), file=sys.stderr)

        # --- PLOT DASHBOARD ---
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#131722', '#2A2E39', '#363C4E'
        cyan_base, orange_base, text_color = '#00BFA5', '#FF9800', '#B2B5BE'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.set_yscale('log')
        
        # Wick Channel
        ax.plot(df.index, df['high'], color='#787B86', linewidth=0.8, linestyle=':', alpha=0.35)
        ax.plot(df.index, df['low'], color='#787B86', linewidth=0.8, linestyle=':', alpha=0.35)
        ax.plot(df.index, df['close'], color=cyan_base, linewidth=2.0, label='Close Price')

        # =========================================================================
        # MULTI-CYCLE FARBMASCHINE: Zeichnet Segmente dynamisch nach Superzyklus
        # =========================================================================
        curr_color = '#D81B60' # Magenta (Zyklus 1)
        curr_style = '-'
        
        for k in range(1, len(snapped_waves)):
            p1 = snapped_waves[k-1]
            p2 = snapped_waves[k]
            lbl2 = p2['raw_label']
            
            # Farb-Weichen je nach Nomenklatur-Grad
            if lbl2 in ['A', 'B', 'C', 'W', 'X', 'Y', 'Z']:
                curr_color = orange_base
                curr_style = '--'
            elif lbl2 in ['(1)', '(2)', '(3)', '(4)', '(5)']:
                curr_color = '#00E5FF' # Leuchtend Cyan (Zyklus 2 Impuls)
                curr_style = '-'
            elif lbl2 in ['(A)', '(B)', '(C)']:
                curr_color = '#FFD54F' # Gelb gestrichelt (Zyklus 2 Korrektur)
                curr_style = '--'
            elif lbl2 in ['I', 'II', 'III', 'IV', 'V']:
                curr_color = '#B388FF' # Flieder/Lila (Zyklus 3 Impuls)
                curr_style = '-'
                
            ax.plot([p1['date'], p2['date']], [p1['price'], p2['price']], 
                    color=curr_color, linewidth=2.5, linestyle=curr_style, marker='o', markersize=9)

        # Labels formatieren
        for sw in snapped_waves:
            xytext = (0, 16) if sw['is_peak'] else (0, -22)
            va = 'bottom' if sw['is_peak'] else 'top'
            lbl = sw['raw_label']
            
            if lbl in ['A', 'B', 'C', 'W', 'X', 'Y', 'Z']: t_col = orange_base
            elif lbl in ['(1)', '(2)', '(3)', '(4)', '(5)']: t_col = '#00E5FF'
            elif lbl in ['(A)', '(B)', '(C)']: t_col = '#FFD54F'
            elif lbl in ['I', 'II', 'III', 'IV', 'V']: t_col = '#B388FF'
            else: t_col = '#D81B60'
            
            ax.annotate(sw['label'], xy=(sw['date'], sw['price']), xytext=xytext, textcoords='offset points', color=t_col, fontsize=20, fontweight='heavy', ha='center', va=va)

        if price_b_gate and not c_is_confirmed:
            ax.hlines(y=price_b_gate, xmin=df.index.min(), xmax=df.index.max() + timedelta(days=25), color='#E53935', linestyle='-.', linewidth=1.5)

        ax.grid(True, which='both', color=grid_color, linestyle='--', linewidth=0.6)
        ax.set_axisbelow(True)
        
        for side in ['top', 'left']: ax.spines[side].set_visible(False)
        for side in ['bottom', 'right']: ax.spines[side].set_color(spine_color)
        
        ax.tick_params(axis='both', which='both', colors=text_color, labelsize=11, color=spine_color)
        ax.yaxis.tick_right()
        ax.set_xlim(df.index.min() - timedelta(days=15), df.index.max() + timedelta(days=25))
            
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')))
        
        fig.text(0.05, 0.92, f"{symbol} - Total-Scan", color='white', fontsize=24, ha='left', va='center', fontweight='bold')
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
    
