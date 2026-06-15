import sys
import json
import io
import matplotlib
matplotlib.use('Agg')  # Verhindert GUI-Fehler auf Headless-Servern
import matplotlib.pyplot as plt
from PIL import Image

def main():
    try:
        # JSON-Daten von Node.js einlesen
        json_str = sys.argv[1]
        data = json.loads(json_str)
        waves = data.get("waves", [])
        candles = data.get("candles", [])
    except Exception:
        sys.exit(1)

    if not candles:
        sys.exit(1)

    # 1. Chart generieren via Matplotlib
    fig, ax = plt.subplots(figsize=(12, 7), facecolor='#131722')
    ax.set_facecolor('#131722')

    # Kurshistorie extrahieren und chronologisch plotten
    closes = [float(c["close"]) for c in candles]
    dates = [c["date"] for c in candles]
    x_indices = list(range(len(candles)))

    # Basis-Kurslinie im TradingView-Stil zeichnen
    ax.plot(x_indices, closes, color='#2962FF', linewidth=2, label="Kurs")

    # Gitterlinien und Achsen stylen
    ax.grid(True, color='#2a2e39', linestyle='--', linewidth=0.5)
    ax.spines['bottom'].set_color('#2a2e39')
    ax.spines['top'].set_color('#131722')
    ax.spines['right'].set_color('#2a2e39')
    ax.spines['left'].set_color('#131722')
    ax.tick_params(colors='#b2b5be', labelsize=9)

    # X-Achsen Beschriftung ausdünnen
    step = max(1, len(dates) // 6)
    ax.set_xticks(x_indices[::step])
    ax.set_xticklabels(dates[::step], color='#b2b5be')

    # 2. Elliott-Wellen einzeichnen (Reine Mathematik, kein Raten via Pixel!)
    impulse_color = "#00F0FF"    # Neon-Cyan
    corrective_color = "#FF8C00"  # Soft-Orange
    
    # Wellenpunkte zu Index-Koordinaten mappen
    wave_points = []
    for w in waves:
        w_date = w.get("date")
        label = str(w.get("label", "")).upper()
        
        # Finde den passenden Index in den echten Kursdaten via Datum
        matched_idx = next((i for i, c in enumerate(candles) if c["date"] == w_date), None)
        if matched_idx is not None:
            wave_points.append((matched_idx, closes[matched_idx], label))

    # Sortieren nach Zeitindex
    wave_points = sorted(wave_points, key=lambda k: k[0])

    # Linien ziehen
    for i in range(len(wave_points) - 1):
        p1, p2 = wave_points[i], wave_points[i+1]
        is_corrective = any(char in p2[2] for char in ["A", "B", "C", "W", "X", "Y"])
        color = corrective_color if is_corrective else impulse_color
        ax.plot([p1[0], p2[0]], [p1[1], p2[1]], color=color, linewidth=3, zorder=4)

    # Knotenpunkte und Beschriftungen setzen
    for p in wave_points:
        idx, price, label = p
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y"])
        color = corrective_color if is_corrective else impulse_color
        
        # Marker auf den exakten Datenpunkt setzen
        ax.scatter(idx, price, color=color, edgecolors='#FFFFFF', s=50, zorder=5)
        
        # Label versetzt über/unter den Punkt rendern
        offset = (ax.get_ylim()[1] - ax.get_ylim()[0]) * 0.04
        text_y = price + offset if label in ["1", "3", "5", "B", "X"] else price - offset
        ax.text(idx, text_y, f"({label})", color='#FFFFFF', fontsize=11, fontweight='bold', ha='center', va='center', zorder=6)

    # Bild in Buffer speichern und per stdout an Node jagen
    buf = io.BytesIO()
    plt.savefig(buf, format='jpeg', dpi=120, bbox_inches='tight')
    buf.seek(0)
    sys.stdout.buffer.write(buf.read())
    plt.close(fig)

if __name__ == "__main__":
    main()
    
