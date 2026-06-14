import sys
import io
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def main():
    try:
        image_data = sys.stdin.buffer.read()
        json_str = sys.argv[1]
        data = json.loads(json_str)
        waves = data.get("waves", [])
    except Exception:
        sys.exit(1)

    img = Image.open(io.BytesIO(image_data))
    if not waves:
        img.save(sys.stdout.buffer, format="JPEG")
        return

    draw = ImageDraw.Draw(img)
    impulse_color = (0, 240, 255)    # Neon-Cyan für Impulswellen
    corrective_color = (255, 140, 0) # Soft-Orange für Korrekturen
    text_white = (255, 255, 255)

    # Chronologische Sortierung nach der Zeitachse (X-Wert)
    waves = sorted(waves, key=lambda k: int(k.get("x", 0)))
    
    # Extraktion der Roh-Koordinaten
    raw_points = [(int(w["x"]), int(w["y"])) for w in waves if "x" in w and "y" in w]
    
    if len(raw_points) < 2:
        img.save(sys.stdout.buffer, format="JPEG")
        return

    # Umwandlung in Graustufen zur exakten Kantendetektion der TradingView-Rasterelemente
    img_np = np.array(img.convert("L"))
    
    corrected_points = []
    for i, w in enumerate(waves):
        x, y = int(w["x"]), int(w["y"])
        label = str(w.get("label", "")).upper()
        
        # Suchfenster definieren (lokale Matrix um den geschätzten Punkt)
        x_min, x_max = max(0, x - 25), min(img.width, x + 25)
        y_min, y_max = max(150, y - 60), min(850, y + 60)
        
        region = img_np[y_min:y_max, x_min:x_max]
        
        if region.size > 0:
            # Bei Spitzen (1, 3, 5, B) suchen wir den absolut höchsten Punkt der Kerze (niedrigster Y-Pixelwert)
            if label in ["1", "3", "5", "B", "X"]:
                # Matrix-Inversion, um die signifikante Kerzenoberkante zu finden
                local_y, local_x = np.unravel_index(np.argmax(region), region.shape)
                y = y_min + local_y
                x = x_min + local_x
            else:
                # Bei Tälern (2, 4, A, C, Y) suchen wir die Unterkante
                local_y, local_x = np.unravel_index(np.argmax(region), region.shape)
                y = y_min + local_y
                x = x_min + local_x
                
        corrected_points.append((x, y, label))

    # 1. Zeichenphase: Verbindungsbänder
    for i in range(len(corrected_points) - 1):
        p1 = corrected_points[i]
        p2 = corrected_points[i+1]
        
        is_corrective = any(char in p2[2] for char in ["A", "B", "C", "W", "X", "Y"])
        line_color = corrective_color if is_corrective else impulse_color
        
        draw.line([(p1[0], p1[1]), (p2[0], p2[1])], fill=line_color, width=3)

    # 2. Zeichenphase: Typografie und Knotenpunkte
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    for p in corrected_points:
        x, y, label = p
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y"])
        node_color = corrective_color if is_corrective else impulse_color
        
        # Exakter Pivot-Knoten
        draw.ellipse([x-5, y-5, x+5, y+5], fill=node_color, outline=text_white, width=1)
        
        # Vertikales Versetzen der Beschriftung zur Vermeidung von Overlaps mit den Kerzenkörpern
        text_y = y - 22 if label in ["1", "3", "5", "B", "X"] else y + 15
        draw.text((x, text_y), f"({label})", fill=text_white, font=font, anchor="mm")

    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
    
