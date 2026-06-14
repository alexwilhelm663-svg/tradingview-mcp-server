import sys
import io
import json
from PIL import Image, ImageDraw, ImageFont

def main():
    # Wir lesen den Screenshot und die JSON-Daten aus der Node.js-Pipeline
    image_data = sys.stdin.buffer.read()
    json_str = sys.argv[1]
    waves = json.loads(json_str)

    # Bild mit Pillow öffnen
    img = Image.open(io.BytesIO(image_data))
    draw = ImageDraw.Draw(img)
    
    # Eine klare, fette Cyan-Farbe für die Linien definieren
    wave_color = (0, 255, 255) # RGB
    text_color = (255, 255, 255) # Weiß für die Zahlen

    # Wir wandeln die JSON-Liste in eine Liste von Koordinaten-Paaren für Pillow um
    points = [ (w["x"], w["y"]) for w in waves ]
    
    # 1. Die Hauptwellen-Polyline zeichnen (Verbindet alle Punkte)
    draw.line(points, fill=wave_color, width=4)
    
    # 2. Die Zahlen (1, 2, 3...) an die Spitzen schreiben
    # Dazu nutzen wir eine einfache Standardschrift.
    font = ImageFont.load_default()
    
    for w in waves:
        # Eine kleine, weiße Zahl direkt über dem Koordinatenpunkt zeichnen
        draw.text((w["x"] - 5, w["y"] - 20), str(w["label"]), fill=text_color, font=font, anchor="mm")

    # Das bearbeitete Bild zurück an Node.js senden
    img.save(sys.stdout.buffer, format="JPEG")

if __name__ == "__main__":
    main()
  
