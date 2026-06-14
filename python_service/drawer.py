import sys
import io
import json
from PIL import Image, ImageDraw, ImageFont

def main():
    try:
        image_data = sys.stdin.buffer.read()
        json_str = sys.argv[1]
        
        # Sicherstellen, dass wir das verschachtelte Objekt korrekt parsen
        data = json.loads(json_str)
        waves = data.get("waves", [])
    except Exception as e:
        sys.exit(1)

    img = Image.open(io.BytesIO(image_data))
    if not waves:
        # Falls keine Wellen übergeben wurden, senden wir das Bild unverändert zurück
        img.save(sys.stdout.buffer, format="JPEG")
        return

    draw = ImageDraw.Draw(img)
    
    # Institutionelle Farbpalette
    impulse_color = (0, 240, 255)  # Cyan
    corrective_color = (255, 140, 0)  # Orange
    text_white = (255, 255, 255)

    # Sortieren nach X-Achse (chronologische Reihenfolge)
    waves = sorted(waves, key=lambda k: k.get("x", 0))
    points = [(int(w["x"]), int(w["y"])) for w in waves if "x" in w and "y" in w]

    # 1. Dynamische Linienführung zeichnen
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i+1]
        
        label_next = str(waves[i+1].get("label", "")).upper()
        # Enthält das nächste Label einen Korrekturbuchstaben, färben wir die Linie orange
        is_corrective = any(char in label_next for char in ["A", "B", "C", "W", "X", "Y"])
        color = corrective_color if is_corrective else impulse_color
        
        draw.line([p1, p2], fill=color, width=3)
        
    # 2. Labels und Ankerpunkte überlagern
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    
    for w in waves:
        if "x" not in w or "y" not in w:
            continue
        x, y = int(w["x"]), int(w["y"])
        label = str(w.get("label", "")).upper()
        
        is_corrective = any(char in label for char in ["A", "B", "C", "W", "X", "Y"])
        dot_color = corrective_color if is_corrective else impulse_color
        
        # Kleinen Kreis auf den Pivot-Punkt setzen
        draw.ellipse([x-4, y-4, x+4, y+4], fill=dot_color, outline=text_white, width=1)
        
        # Abstandhalter für verbesserte Lesbarkeit (Padding)
        if label in ["1", "3", "5", "B", "X"]:
            text_pos = (x, y - 20)
        else:
            text_pos = (x, y + 15)
            
        draw.text(text_pos, f"({label})", fill=text_white, font=font, anchor="mm")

    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
    
