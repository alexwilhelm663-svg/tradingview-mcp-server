import sys
import json
import io
import matplotlib
matplotlib.use('Agg')  # Verhindert GUI-Fehler auf Headless-Servern
import matplotlib.pyplot as plt

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

    # Chart-Dimensionen und TradingView-Dunkelmodus-Farben definieren
    fig, ax = plt.subplots(figsize=(15, 8), facecolor='#131722')
    ax.set_facecolor('#131722')

    x_indices = list(range(len(candles)))
    dates = [c["date"] for c in candles]

    # --- ECHTE CANDLESTICKS ZEICHNEN ---
    for i, c in enumerate(candles):
        open_p = float(c.get("open") or c["close"])
        close_p = float(c["close"])
        high_p = float(c["high"])
        low_p = float(c["low"])

        # Farbe bestimmen (Grün für steigend, Rot für fallend)
        color = '#26a69a' if close_p >= open_p else '#ef5350'

        # 1. Docht und Lunte zeichnen (High/Low-Linie)
        ax.plot([i, i], [low_p, high_p], color=color, linewidth=1.5, zorder=2)

        # 2. Kerzenkörper zeichnen (Open/Close-Balken)
        body_bottom = min(open_p, close_p)
        body_height = max(abs(open_p - close_p), 0.01)
        rect = plt.Rectangle((i - 0.35, body_bottom), 0.7, body_height, facecolor=color, edgecolor=color, zorder=3)
        ax.add_patch(rect)

    # --- ELLIOTT-WELLEN (INTELLIGENTE HOCH/TIEF-ZUORDNUNG) ---
    impulse_color = "#00F0FF"     # Neon-Cyan für Impulswellen
    corrective_color = "#FF9800"  # Orange für Korrekturwellen
    
    wave_points = []
    for w in waves:
        w_date = w.get("date")
        label = str(w.get("label", "")).upper()
        
        # Finde den passenden Zeitindex anhand des Datums
        matched_idx = next((i for i, candle in enumerate(candles) if candle["date"] == w_date), None)
        if matched_idx is not None:
            candle = candles[matched_idx]
            high_p = float(candle["high"])
            low_p = float(candle["low"])

            # Regeleinhaltung nach Prechter: Hochs an Spitzen, Tiefs an Tiefpunkte
            if any(char in label for char in ["1", "3", "5", "B", "X"]):
                price = high_p
                is_high = True
            else:
                price = low_p
                is_high = False

            wave_points.append((matched_idx, price, label, is_high))

    # Chronologisch nach Zeitindex sortieren
    wave_points = sorted(wave_points, key=lambda k: k[0])

    # Struktur-Linien ziehen
    for i in range(len(wave_points) - 1):
        p1, p2 = wave_points[i], wave_points[i+1]
        is_corrective = any(char in p2[2] for char in ["A", "B", "C", "W", "X", "Y"])
        line_color = corrective_color if is_corrective else impulse_color
        ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=line_color, linewidth=2.5, zorder=4)

    # Labels und Marker setzen
    y_limits = ax.get_ylim()
    offset = (y_limits[1] - y_limits[0]) * 0.03  # Dynamischer Abstand für die Textboxen

    for p in wave_points:
        idx, price, label, is_high = p
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y"])
        text_color = corrective_color if is_corrective else impulse_color
        
        # Weisser Kern-Marker auf dem exakten Scheitelpunkt der Kerze
        ax.scatter(idx, price, color='#FFFFFF', edgecolors=text_color, s=40, linewidths=1.5, zorder=5)
        
        # Text sauber über dem High oder unter dem Low platzieren (keine Überlagerung der Kerzenkörper)
        text_y = price + offset if is_high else price - offset
        ax.text(idx, text_y, f"{label}", color='#FFFFFF', fontsize=12, fontweight='bold',
                ha='center', va='center', bbox=dict(boxstyle="round,pad=0.2", facecolor='#131722', edgecolor=text_color, lw=1), zorder=6)

    # --- GRID & ACHSEN STYLING ---
    ax.grid(True, color='#2a2e39', linestyle=':', linewidth=0.5)
    ax.spines['bottom'].set_color('#2a2e39')
    ax.spines['top'].set_color('#131722')
    ax.spines['right'].set_color('#2a2e39')
    ax.spines['left'].set_color('#131722')
    ax.tick_params(colors='#b2b5be', labelsize=10)

    # X-Achsen Beschriftung formatieren (Maximale Lesbarkeit bei 45 Kerzen)
    step = max(1, len(dates) // 6)
    ax.set_xticks(x_indices[::step])
    ax.set_xticklabels(dates[::step], color='#b2b5be', rotation=0)

    # Bild in den Byte-Stream konvertieren und an stdout übergeben
    buf = io.BytesIO()
    plt.savefig(buf, format='jpeg', dpi=130, bbox_inches='tight')
    buf.seek(0)
    sys.stdout.buffer.write(buf.read())
    plt.close(fig)

if __name__ == "__main__":
    main()
    
