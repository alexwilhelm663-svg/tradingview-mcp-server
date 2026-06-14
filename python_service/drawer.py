import sys
import io
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.signal import find_peaks

def main():
    try:
        image_data = sys.stdin.buffer.read()
        json_str = sys.argv[1]
        gemini_data = json.loads(json_str)
    except Exception as e:
        sys.exit(1)

    img = Image.open(io.BytesIO(image_data))
    draw = ImageDraw.Draw(img)
    
    # Farben für das institutionelle Layout
    impulse_color = (0, 240, 255)  # Cyan
    corrective_color = (255, 140, 0)  # Orange
    text_white = (255, 255, 255)

    # Geminis vorgeschlagene Wellen
    waves = gemini_data.get("waves", [])
    if not waves:
        # Fallback: Wenn Gemini versagt, unverändertes Bild zurückgeben
        img.save(sys.stdout.buffer, format="JPEG")
        return

    # Sortieren der Wellen nach der X-Achse (chronologisch)
    waves = sorted(waves, key=lambda k: k["x"])
    points = [(int(w["x"]), int(w["y"])) for w in waves]

    # Zeichne die berechneten Wellen-Linien
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i+1]
        
        label_next = str(waves[i+1]["label"]).upper()
        is_corrective = any(char in label_next for char in ["A", "B", "C"])
        color = corrective_color if is_corrective else impulse_color
        
        draw.line([p1, p2], fill=color, width=3)

    # Labels präzise über/unter den Punkten einrasten lassen
    font = ImageFont.load_default()
    for w in waves:
        x, y = int(w["x"]), int(w["y"])
        label = str(w["label"]).upper()
        
        is_corrective = any(char in label for char in ["A", "B", "C"])
        dot_color = corrective_color if is_corrective else impulse_color
        
        # Punkt direkt auf der Kerze zeichnen
        draw.ellipse([x-4, y-4, x+4, y+4], fill=dot_color, outline=text_white, width=1)
        
        # Hoch-/Tiefpunkt-Korrektur für die Schriftplatzierung
        if label in ["1", "3", "5", "B"]:
            text_pos = (x, y - 20)
        else:
            text_pos = (x, y + 15)
            
        draw.text(text_pos, f"({label})", fill=text_white, font=font, anchor="mm")

    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
    
