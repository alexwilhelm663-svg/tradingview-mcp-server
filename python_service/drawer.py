import sys
import io
import json
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
    impulse_color = (0, 240, 255)    # Neon-Cyan für Impuls
    corrective_color = (255, 140, 0) # Soft-Orange für Korrektur
    text_white = (255, 255, 255)

    # Chronologische Sortierung der Wellen
    waves = sorted(waves, key=lambda k: int(k.get("x", 0)))
    
    # --- MATHEMATISCHES PRICE-TO-PIXEL MAPPING ---
    # Da TradingView das Widget standardmäßig skaliert, nutzen wir Geminis validierte 
    # Koordinaten als strukturelle Anker, bereinigen aber radikal mathematische Ausreißer 
    # im leeren Raum (Y-Grenzwerte).
    corrected_points = []
    for w in waves:
        x = int(w["x"])
        y = int(w["y"])
        label = str(w.get("label", "")).upper()
        
        # Harte geometrische Begrenzung: Kerzen können im Widget niemals im 
        # "Himmel" (Y < 150) oder im Menü (Y > 880) existieren.
        if y < 180: y = 180
        if y > 850: y = 850
        
        corrected_points.append((x, y, label))

    # 1. Linien zeichnen
    for i in range(len(corrected_points) - 1):
        p1 = corrected_points[i]
        p2 = corrected_points[i+1]
        
        is_corrective = any(char in p2[2] for char in ["A", "B", "C", "W", "X", "Y"])
        line_color = corrective_color if is_corrective else impulse_color
        
        draw.line([(p1[0], p1[1]), (p2[0], p2[1])], fill=line_color, width=3)

    # 2. Ankerpunkte und Labels setzen
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    for p in corrected_points:
        x, y, label = p
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y"])
        node_color = corrective_color if is_corrective else impulse_color
        
        # Sauberer Kreis auf dem Docht
        draw.ellipse([x-5, y-5, x+5, y+5], fill=node_color, outline=text_white, width=1)
        
        # Perfekt ausgerichtetes Padding über/unter der Kerze
        text_y = y - 22 if label in ["1", "3", "5", "B", "X"] else y + 15
        draw.text((x, text_y), f"({label})", fill=text_white, font=font, anchor="mm")

    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
    
