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

# =========================================================================
# UNIVERSAL ALPHANUMERIC STEM CLASSIFIER
# =========================================================================
def resolve_wave_role(raw_label):
    clean = raw_label.replace('(', '').replace(')', '').replace('[', '').replace(']', '').replace('{', '').replace('}', '').strip().upper()
    for separator in ['.', '-', ' ']:
        if separator in clean:
            clean = clean.split(separator)[-1]
            
    peaks = ['1', '3', '5', 'B', 'I', 'III', 'V', 'X']
    troughs = ['0', '2', '4', 'A', 'C', 'II', 'IV', 'W', 'Y', 'Z']
    
    if clean in peaks: return True
    elif clean in troughs: return False
    else: return True 

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
        
        snapped_waves = []
        for w in waves:
            raw_upper = str(w['label']).upper().strip()
            is_pk = resolve_wave_role(raw_upper)
            
            snapped_waves.append({
                'label': w['label'],
                'raw_label': raw_upper,
                'ai_date': pd.to_datetime(w['date'], errors='coerce'),
                'is_peak': is_pk,
                'date': None,
                'price': None
            })

        # --- 1. TRUE GENESIS BASE LOCK ---
        w0 = snapped_waves[0]
        genesis_pocket = df.iloc[:35]
        actual_w0_date = genesis_pocket['low'].idxmin() if not genesis_pocket.empty else df.index.min()
        w0['date'] = actual_w0_date
        w0['price'] = float(df.loc[actual_w0_date, 'low'])

        # --- 2. STRICT CAUSAL FORWARD CANYON ---
        for i in range(1, len(snapped_waves)):
            sw = snapped_waves[i]
            prev_locked_date = snapped_waves[i-1]['date']
            t_target = sw['ai_date']

            win_start = prev_locked_date + timedelta(days=1)

            if i < len(snapped_waves) - 1:
                t_next = snapped_waves[i+1]['ai_date']
                if not pd.isna(t_next) and t_next > win_start:
                    win_end = t_next + timedelta(days=15)
                else:
                    win_end = win_start + timedelta(days=90)
            else:
                win_end = df.index.max()

            if pd.isna(t_target) or t_target < win_start:
                t_target = win_start + timedelta(days=30)

            if win_start > df.index.max(): win_start = df.index.max()
            if win_end > df.index.max(): win_end = df.index.max()
            if win_end <= win_start: win_end = win_start + timedelta(days=25)

            mask = (df.index >= win_start) & (df.index <= win_end)
            win = df[mask]

            if not win.empty:
                actual_date = win['high'].idxmax() if sw['is_peak'] else win['low'].idxmin()
                price = win.loc[actual_date, 'high' if sw['is_peak'] else 'low']
            else:
                actual_date = win_start if win_start in df.index else df.index[df.index.get_indexer([win_start], method='nearest')[0]]
                price = df.loc[actual_date, 'high' if sw['is_peak'] else 'low']

            if isinstance(price, pd.Series): price = price.iloc[0]

            sw['date'] = actual_date
            sw['price'] = float(price)

        context_start = w0['date'] - timedelta(days=365)
        if context_start < df.index.min(): context_start = df.index.min()
        df = df.loc[context_start:]
        if df.empty: sys.exit(1)

        # --- 3. UNIVERSAL QUANT FIBONACCI ENGINE ---
        c_is_confirmed = True
        price_b_gate = None
        last_close = df['close'].iloc[-1]
        last_date = df.index.max()

        fib_upper, fib_lower, fib_sweetspot = None, None, None
        fib_zone_label = "🎯 Fib Target Zone"

        if len(snapped_waves) > 1:
            last_sw = snapped_waves[-1]
            if not last_sw['is_peak']:
                for j in range(len(snapped_waves)-2, -1, -1):
                    if snapped_waves[j]['is_peak']:
                        price_b_gate = snapped_waves[j]['price']
                        break
                
                if price_b_gate is not None and last_close < price_b_gate:
                    c_is_confirmed = False
                    last_sw['label'] += " ( ? )"
                    
                    nukleus = last_sw['raw_label'].replace('(', '').replace(')', '').replace('[', '').replace(']', '').strip()
                    if '.' in nukleus: nukleus = nukleus.split('.')[-1]
                    elif '-' in nukleus: nukleus = nukleus.split('-')[-1]

                    if nukleus in ['2', 'II']:
                        p1, p0 = None, None
                        for sw in snapped_waves[:-1]:
                            if sw['is_peak']: p1 = sw['price']
                            else: p0 = sw['price']
                        if p1 and p0 and p1 > p0:
                            ratio = p0 / p1
                            fib_upper = p1 * (ratio ** 0.500)
                            fib_lower = p1 * (ratio ** 0.618)
                            fib_sweetspot = fib_lower
                            fib_zone_label = "🎯 Fib Zone (50% - 61.8% Retracement)"

                    elif nukleus in ['4', 'IV']:
                        p3, p2 = None, None
                        for sw in snapped_waves[:-1]:
                            if sw['is_peak']: p3 = sw['price']
                            else: p2 = sw['price']
                        if p3 and p2 and p3 > p2:
                            ratio = p2 / p3
                            fib_upper = p3 * (ratio ** 0.382)
                            fib_lower = p3 * (ratio ** 0.500)
                            fib_sweetspot = fib_upper
                            fib_zone_label = "🎯 Fib Zone (38.2% - 50% Retracement)"

                    elif nukleus in ['C', 'Y', 'Z']:
                        pb, pa_low, pa_high = None, None, None
                        for idx in range(len(snapped_waves)-2, -1, -1):
                            sw = snapped_waves[idx]
                            if sw['is_peak'] and pb is None: pb = sw['price']
                            elif not sw['is_peak']:
                                pa_low = sw['price']
                                if idx > 0: pa_high = snapped_waves[idx-1]['price']
                                break
                        if pb and pa_low and pa_high and pa_high > pa_low:
                            vec_ratio = pa_low / pa_high
                            fib_upper = pb * (vec_ratio ** 0.618)
                            fib_lower = pb * (vec_ratio ** 1.618)
                            fib_sweetspot = pb * (vec_ratio ** 1.000) 
                            fib_zone_label = "🎯 Fib Extension Zone (0.618 - 1.618 A=C)"

                    if fib_upper is None and price_b_gate:
                        fib_upper = price_b_gate * 0.65
                        fib_lower = price_b_gate * 0.40
                        fib_sweetspot = price_b_gate * 0.50

                    if fib_sweetspot:
                        last_sw['date'] = last_date + timedelta(days=15)
                        last_sw['price'] = fib_sweetspot

        print(json.dumps({
            "correction_gate": {
                "b_gate_price": price_b_gate if price_b_gate else 0,
                "current_close": float(last_close),
                "is_confirmed": c_is_confirmed,
                "fib_upper": float(fib_upper) if fib_upper else 0,
                "fib_lower": float(fib_lower) if fib_lower else 0,
                "fib_sweetspot": float(fib_sweetspot) if fib_sweetspot else 0
            }
        }), file=sys.stderr)

        # =========================================================================
        # --- PLOT DASHBOARD: TRADINGVIEW CRISP CLASSIC LIGHT THEME ---
        # =========================================================================
        plt.rcParams['font.family'] = 'sans-serif'
        fig, ax = plt.subplots(figsize=(16, 8))
        
        bg_color, grid_color, spine_color = '#FFFFFF', '#E0E3EB', '#131722'
        price_line_col, wick_col = '#1E222D', '#A3A6AF'
        
        impulse_blue = '#2962FF'
        correction_orange = '#FF9800'
        
        fig.patch.set_facecolor(bg_color)
        ax.set_facecolor(bg_color)
        ax.set_yscale('log')
        
        ax.plot(df.index, df['high'], color=wick_col, linewidth=0.8, linestyle=':', alpha=0.5)
        ax.plot(df.index, df['low'], color=wick_col, linewidth=0.8, linestyle=':', alpha=0.5)
        ax.plot(df.index, df['close'], color=price_line_col, linewidth=1.8, label='Close Price')

        # --- POLYGON SHADING ENGINE ---
        poly_dates, poly_prices = [], []
        
        for idx_sw, sw in enumerate(snapped_waves):
            poly_dates.append(sw['date'])
            poly_prices.append(sw['price'])
            
            nuk = sw['raw_label'].replace('(', '').replace(')', '').replace('[', '').replace(']', '').strip()
            if '.' in nuk: nuk = nuk.split('.')[-1]
            
            if nuk in ['5', 'V'] and len(poly_dates) >= 3:
                ax.fill(poly_dates, poly_prices, color=impulse_blue, alpha=0.08, edgecolor='none')
                poly_dates = [sw['date']] 
                poly_prices = [sw['price']]
            elif nuk in ['C', 'Y', 'Z'] and len(poly_dates) >= 3:
                ax.fill(poly_dates, poly_prices, color=correction_orange, alpha=0.12, edgecolor='none')
                poly_dates = [sw['date']]
                poly_prices = [sw['price']]

        if len(poly_dates) >= 3:
            ax.fill(poly_dates, poly_prices, color=impulse_blue if resolve_wave_role(snapped_waves[-1]['raw_label']) else correction_orange, alpha=0.08, edgecolor='none')

        # --- WELLEN-LINIEN & PIVOT-MARKER ---
        for k in range(1, len(snapped_waves)):
            p1 = snapped_waves[k-1]
            p2 = snapped_waves[k]
            lbl_raw = p2['raw_label']
            is_sub = ('.' in lbl_raw) or any(c.islower() for c in p2['label']) or ('((' in lbl_raw)
            
            if is_sub:
                c_line, c_style, l_w, m_s = '#FF4081', '-', 1.5, 6
            else:
                l_w, m_s = 2.2, 9
                if not p2['is_peak']: c_line, c_style = correction_orange, '--'
                elif '(' in lbl_raw: c_line, c_style = '#00BFA5', '-' 
                # FIX: Saubere Generator-Abfrage statt kaputter .any() Listen-Methode!
                elif any(c in lbl_raw for c in ['I', 'V', 'X']): c_line, c_style = '#7B1FA2', '-' 
                else: c_line, c_style = impulse_blue, '-'
                
            ax.plot([p1['date'], p2['date']], [p1['price'], p2['price']], color=c_line, linewidth=l_w, linestyle=c_style, marker='o', markersize=m_s)

        if not c_is_confirmed and fib_upper and fib_lower:
            y_b = min(fib_lower, fib_upper)
            y_t = max(fib_lower, fib_upper)
            ax.axhspan(ymin=y_b, ymax=y_t, facecolor='#00BFA5', alpha=0.18, label=fib_zone_label)
            ax.hlines(y=fib_sweetspot, xmin=df.index.min(), xmax=last_date + timedelta(days=30), color='#00BFA5', linestyle=':', linewidth=2.0)
            ax.annotate(f"🎯 SWEETSPOT ({fib_sweetspot:,.2f} USD)", xy=(last_date, fib_sweetspot), xytext=(0, 6), textcoords='offset points', color='#00BFA5', fontsize=11, fontweight='bold', ha='right', va='bottom')

        for sw_idx, sw in enumerate(snapped_waves):
            offset_y = 16 if sw['is_peak'] else -22
            if sw_idx > 1 and sw['is_peak'] == snapped_waves[sw_idx-2]['is_peak']:
                offset_y = 36 if sw['is_peak'] else -42

            va = 'bottom' if sw['is_peak'] else 'top'
            lbl_raw = sw['raw_label']
            is_sub = ('.' in lbl_raw) or any(c.islower() for c in sw['label']) or ('((' in lbl_raw)
            
            f_size = 13 if is_sub else 18
            if "( ? )" in sw['label']: t_col = '#E53935' 
            elif is_sub: t_col = '#FF4081'
            elif not sw['is_peak']: t_col = '#E65100' 
            elif '(' in lbl_raw: t_col = '#00796B' 
            # FIX: Saubere Generator-Abfrage auch bei den Text-Labels!
            elif any(c in lbl_raw for c in ['I', 'V', 'X']): t_col = '#4A148C'
            else: t_col = impulse_blue
            
            ax.annotate(sw['label'], xy=(sw['date'], sw['price']), xytext=(0, offset_y), textcoords='offset points', color=t_col, fontsize=f_size, fontweight='bold', ha='center', va=va)

        if price_b_gate and not c_is_confirmed:
            ax.hlines(y=price_b_gate, xmin=df.index.min(), xmax=last_date + timedelta(days=30), color='#E53935', linestyle='-.', linewidth=1.5)
            ax.annotate(f"🔒 GATE ({price_b_gate:,.2f} USD)", xy=(last_date, price_b_gate), xytext=(0, 6), textcoords='offset points', color='#E53935', fontsize=11, fontweight='bold', ha='right', va='bottom')

        ax.grid(True, which='both', color=grid_color, linestyle='-', linewidth=0.8)
        ax.set_axisbelow(True)
        
        for side in ['top', 'left']: ax.spines[side].set_visible(False)
        for side in ['bottom', 'right']: ax.spines[side].set_color(spine_color)
        
        ax.tick_params(axis='both', which='both', colors=spine_color, labelsize=11)
        ax.yaxis.tick_right()
        ax.set_xlim(df.index.min() - timedelta(days=15), df.index.max() + timedelta(days=30))
            
        locator = mdates.AutoDateLocator(minticks=5, maxticks=10)
        ax.xaxis.set_major_locator(locator)
        ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(locator))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"{x:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')))
        
        fig.text(0.05, 0.92, f"{symbol} - Official TradingView Light Theme", color=spine_color, fontsize=24, ha='left', va='center', fontweight='bold')
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
    
