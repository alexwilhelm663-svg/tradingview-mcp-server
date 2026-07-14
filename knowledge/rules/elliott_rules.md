---
category: elliott_waves
source: Elliott Wave Validator v4.0
status: institutional
type: knowledge_rule
version: 4
---

# Elliott-Wellen Regelwerk (Institutional OKF v4.0)

## Ziel

Dieses Regelwerk definiert einen deterministischen Standard zur
Validierung von Elliott-Wellen. Es trennt zwingende Regeln von
probabilistischen Richtlinien und dient als Grundlage für automatisierte
Scanner und institutionelle Analysen.

## 1. Grundprinzipien

-   Arbeite ausschließlich regelbasiert.
-   Keine Interpretation ohne Evidenz.
-   Keine erzwungenen Zählungen.
-   Bevorzuge niemals einen bullischen oder bärischen Bias.
-   Verwerfe ungültige Strukturen konsequent.
-   Liefere Alternativzählungen, sofern mehrere valide Lösungen
    existieren.

## 2. Priorität der Regeln

### MUST (harte Regeln)

Ein Verstoß macht die Zählung ungültig.

### SHOULD (starke Richtlinien)

Beeinflussen die Wahrscheinlichkeit.

### MAY (optionale Merkmale)

Erhöhen oder reduzieren die Konfidenz.

## 3. Datenvalidierung

Vor jeder Analyse prüfen:

-   Chronologisch korrekte Kursdaten
-   Split- und Dividendenanpassungen
-   Keine offensichtlichen Datenfehler
-   Ausreichende Historie
-   Ausreichende Liquidität

## 4. Fraktalgesetz

-   Jede Impulswelle besteht aus fünf Unterwellen.
-   Jede Korrektur besitzt ihre definierte interne Struktur.
-   Jeder Degree wird separat validiert.
-   Degrees dürfen nicht vermischt werden.

## 5. Multi-Timeframe-Regeln

Die Zählung muss zwischen Monthly, Weekly, Daily, 4H und 1H konsistent
sein.

Niedrigere Zeitebenen dürfen höheren Degrees nicht widersprechen.

## 6. Motive Wellen

### MUST

-   W2 retraced niemals mehr als 100 % von W1.
-   W3 überschreitet immer das Ende von W1.
-   W3 ist niemals die kürzeste Antriebswelle.
-   W4 überlappt W1 nicht (Ausnahme: Diagonalen).
-   W3 besitzt selbst eine vollständige 5-Wellen-Struktur.

### SHOULD

-   Genau eine Extension.
-   Alternation zwischen W2 und W4.
-   Trendkanal bleibt weitgehend intakt.
-   Fibonacci-Relationen vorhanden.

## 7. Diagonalen

### Leading Diagonal

-   Position W1 oder A
-   5-3-5-3-5 bevorzugt
-   3-3-3-3-3 als zulässige Alternative

### Ending Diagonal

-   Position W5 oder C
-   Struktur 3-3-3-3-3
-   Überlappung W1/W4 erlaubt
-   Konvergierender oder divergierender Keil

## 8. Korrekturen

Unterstützte Muster

-   Zigzag
-   Double Zigzag
-   Triple Zigzag
-   Regular Flat
-   Expanded Flat
-   Running Flat
-   Triangle
-   Contracting Triangle
-   Expanding Triangle
-   Double Three
-   Triple Three

## 9. Fibonacci-Engine

### Retracements

-   23.6 %
-   38.2 %
-   50 %
-   61.8 %
-   78.6 %

### Projektionen

-   1.000
-   1.272
-   1.618
-   2.618
-   4.236

Keine Projektion ohne Referenzwelle.

## 10. Zeitsymmetrie

Prüfe Fibonacci-Zeitrelationen zwischen

-   W1 und W2
-   W2 und W4
-   A und C

Bevorzugte Faktoren:

-   0.618
-   1.000
-   1.618

## 11. Momentum

W3 sollte besitzen:

-   höchstes Momentum
-   höchsten ADX
-   stärksten MACD
-   stärkste Marktbreite

W5 zeigt häufig Divergenzen.

## 12. Volumen

Typischer Verlauf:

-   W1 steigend
-   W3 Maximum
-   W5 nachlassend
-   Korrekturen rückläufig

## 13. Kanalregeln

Akzeptierte Kanäle:

-   W2/W4
-   W1/W3

Throw-over nur mit Momentum- und Volumenbestätigung.

## 14. Alternativzählungen

Immer erzeugen:

1.  Primary Count
2.  Alternate Count
3.  Low Probability Count

## 15. Score-Modell

Bewerte getrennt:

-   Regelkonformität
-   Fraktalstruktur
-   Fibonacci
-   Zeit
-   Momentum
-   Volumen
-   Kanal
-   Alternation
-   Degree-Konsistenz
-   Multi-Timeframe

Berechne daraus einen Gesamtscore von 0--100.

## 16. Konfidenzklassen

-   95--100: Institutionelle Qualität
-   90--94: Sehr hoch
-   80--89: Hoch
-   70--79: Mittel
-   60--69: Schwach
-   \<60: Verwerfen

## 17. Ausgabeformat

Für jede Zählung:

-   Primary Count
-   Alternate Count
-   Degree
-   Struktur
-   Regelverstöße
-   Fibonacci
-   Zeit
-   Momentum
-   Volumen
-   Kanal
-   Invalidierungslevel
-   Kursziele
-   Wahrscheinlichkeitsbegründung
-   Gesamtscore

## 18. Verbotene Verhaltensweisen

-   Keine erfundenen Wellen.
-   Keine nachträgliche Anpassung an Wunschziele.
-   Keine unbegründeten Wahrscheinlichkeiten.
-   Keine Verletzung von MUST-Regeln.

Falls keine gültige Struktur existiert:

> Keine valide Elliott-Wellen-Struktur vorhanden. Analyse verworfen.
> 
