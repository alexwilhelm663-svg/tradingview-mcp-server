import sys
import io
import json
from PIL import Image, ImageDraw, ImageFont

def main():
    try:
        image_data = sys.stdin.buffer.read()
        json_str = sys.argv[1]
        waves = json.loads(json_str)
    except Exception as e:
        sys.exit(1)

    img = Image.open(io.BytesIO(image_data))
    draw = ImageDraw.Draw(img)
    
    # Professionelle Farbpalette (Neon-Cyan für Impuls, Soft-Orange für Korrektur)
    impulse_color = (0, 240, 255)  
    corrective_color = (255, 140, 0)
    text_white = (255, 255, 255)

    points = [(int(w["x"]), int(w["y"])) for w in waves]
    
    # 1. Wellen-Linien sauber zeichnen
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i+1]
        
        # Bestimmen, ob es sich um eine Korrekturwelle handelt (Label enthält A, B oder C)
        label_next = str(waves[i+1]["label"]).upper()
        is_corrective = any(char in label_next for char in ["A", "B", "C"])
        color = corrective_color if is_corrective else impulse_color
        
        # Haupttrendlinie zeichnen
        draw.line([p1, p2], fill=color, width=3)
        
    # 2. Wellen-Labels und Ankerpunkte setzen
    font = ImageFont.load_default()
    
    for i, w in enumerate(waves):
        x, y = int(w["x"]), int(w["y"])
        label = str(w["label"]).upper()
        
        # Kleinen Ankerpunkt auf die Kerzenspitze zeichnen
        is_corrective = any(char in label for char in ["A", "B", "C"])
        dot_color = corrective_color if is_corrective else impulse_color
        draw.ellipse([x-4, y-4, x+4, y+4], fill=dot_color, outline=text_white, width=1)
        
        # Textplatzierung optimieren (Täler nach unten verschieben, Spitzen nach oben)
        # Ungerade Zahlen (1, 3, 5) und B sind meistens Spitzen -> Text nach oben
        # Gerade Zahlen (2, 4) und A, C sind meistens Täler -> Text nach unten
        if label in ["1", "3", "5", "B"]:
            text_pos = (x, y - 22)
        else:
            text_pos = (x, y + 12)
            
        # Text mit lesbarem Kontrast-Hintergrund zeichnen
        draw.text(text_pos, f"({label})", fill=text_white, font=font, anchor="mm")

    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
    
