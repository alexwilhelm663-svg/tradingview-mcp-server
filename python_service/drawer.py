import sys
import json
import io
import datetime
import matplotlib
matplotlib.use('Agg')  
import matplotlib.pyplot as plt

def parse_date(d_str):
    try:
        # Schneidet die Uhrzeit bei 1H-Daten weg für den reinen Datumsvergleich, 
        # oder parst das YYYY-MM-DD Format.
        return datetime.datetime.strptime(d_str[:10], "%Y-%m-%d")
    except Exception:
        return datetime.datetime.now()

def main():
    try:
        json_str = sys.argv[1]
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
    except Exception:
        sys.exit(1)

    if not candles:
        sys.exit(1)

    fig, ax = plt.subplots(figsize=(15, 8), facecolor='#131722')
    ax.set_facecolor('#131722')

    x_indices = list(range(len(candles)))
    dates = [c["date"] for c in candles]

    # --- CANDLESTICKS ZEICHNEN ---
    for i, c in enumerate(candles):
        open_p = float(c.get("open") or c["close"])
        close_p = float(c["close"])
        high_p = float(c["high"])
        low_p = float(c["low"])

        color = '#26a69a' if close_p >= open_p else '#ef5350'
        ax.plot([i, i], [low_p, high_p], color=color, linewidth=1.5, zorder=2)

        body_bottom = min(open_p, close_p)
        body_height = max(abs(open_p - close_p), 0.01)
        rect = plt.Rectangle((i - 0.35, body_bottom), 0.7, body_height, facecolor=color, edgecolor=color, zorder=3)
        ax.add_patch(rect)

    # --- ELLIOTT-WELLEN (SMART MATCHING) ---
    impulse_color = "#00F0FF"     
    corrective_color = "#FF9800"  
    
    wave_points = []
    last_price = None

    for w in waves:
        w_date = w.get("date")
        label = str(w.get("label", "")).upper()
        
        # FUZZY MATCHING: Finde die Kerze, die dem KI-Datum am nächsten liegt
        target_dt = parse_date(w_date)
        closest_idx = min(range(len(candles)), key=lambda i: abs((parse_date(candles[i]["date"]) - target_dt).days))
        
        candle = candles[closest_idx]
        high_p = float(candle["high"])
        low_p = float(candle["low"])
        close_p = float(candle["close"])

        # DYNAMISCHE HOCH/TIEF-ERKENNUNG: 
        if last_price is None:
            # Erster Punkt: Heuristik (näher am Docht oder an der Lunte?)
            is_high = True if abs(close_p - high_p) < abs(close_p - low_p) else False
            price = high_p if is_high else low_p
        else:
            # Ist der neue Punkt tiefer als der vorherige Welle-Punkt? -> Tiefpunkt nutzen
            if close_p < last_price:
                price = low_p
                is_high = False
            else:
                price = high_p
                is_high = True
                
        last_price = price
        wave_points.append((closest_idx, price, label, is_high))

    wave_points = sorted(wave_points, key=lambda k: k[0])

    # Linien ziehen
    for i in range(len(wave_points) - 1):
        p1, p2 = wave_points[i], wave_points[i+1]
        is_corrective = any(char in p2[2] for char in ["A", "B", "C", "W", "X", "Y", "II", "IV"])
        line_color = corrective_color if is_corrective else impulse_color
        ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=line_color, linewidth=2.5, zorder=4)

    # Labels setzen
    y_limits = ax.get_ylim()
    offset = (y_limits[1] - y_limits[0]) * 0.03  

    for p in wave_points:
        idx, price, label, is_high = p
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y", "II", "IV"])
        text_color = corrective_color if is_corrective else impulse_color
        
        ax.scatter(idx, price, color='#FFFFFF', edgecolors=text_color, s=40, linewidths=1.5, zorder=5)
        
        text_y = price + offset if is_high else price - offset
        ax.text(idx, text_y, f"{label}", color='#FFFFFF', fontsize=12, fontweight='bold',
                ha='center', va='center', bbox=dict(boxstyle="round,pad=0.2", facecolor='#131722', edgecolor=text_color, lw=1), zorder=6)

    ax.grid(True, color='#2a2e39', linestyle=':', linewidth=0.5)
    ax.spines['bottom'].set_color('#2a2e39')
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['left'].set_color('#2a2e39')
    ax.tick_params(colors='#b2b5be', labelsize=10)

    # X-Achsen-Beschriftung aufräumen
    step = max(1, len(dates) // 8)
    ax.set_xticks(x_indices[::step])
    ax.set_xticklabels(dates[::step], color='#b2b5be', rotation=0)

    buf = io.BytesIO()
    plt.savefig(buf, format='jpeg', dpi=130, bbox_inches='tight')
    buf.seek(0)
    sys.stdout.buffer.write(buf.read())
    plt.close(fig)

if __name__ == "__main__":
    main()
    
