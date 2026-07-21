---
type: knowledge_rule
category: elliott_waves
version: 5.1
scope: Single Source of Truth für Engine (deterministisch) und Kritiker (LLM-Review)
konvention: Preislängen mehrjähriger Bewegungen werden logarithmisch gemessen (DK-2)
---
# Elliott-Wellen-Regelwerk (OKF-Basis)

Jede Regel trägt eine stabile ID. **HR** = harte Regel (Verstoß = Zählung ungültig),
**GL** = Guideline (Qualität/Score), **KO** = Korrekturmuster, **DG** = Diagonale,
**FB** = Fibonacci-Relation, **VG** = maschinelles Validierungs-Gesetz,
**DK** = Engine-Doktrin (Policy, bewusst strenger als der Kanon).
Der Kritiker zitiert IDs, die Trace-Matrix (§8) verortet jede Regel im Code.

## 1. Harte Regeln des Impulses (Kanon)

- **HR-1** Welle 2 korrigiert Welle 1 niemals über 100 %: Das W2-Extrem
  verletzt den Ursprung von Welle 1 nicht.
- **HR-2** Welle 3 ist niemals die kürzeste der Antriebswellen 1, 3, 5
  (Messung nach DK-2 in Log-Länge).
- **HR-3** Welle 4 dringt niemals in das Preisgebiet von Welle 1 ein
  (Overlap-Verbot). Einzige Kanon-Ausnahme: Diagonalen (DG-1/DG-2).
- **HR-4** Welle 3 überschreitet stets das Ende von Welle 1.
- **HR-5** Antriebswellen (1, 3, 5) unterteilen sich impulsiv (5er oder
  Diagonale), Korrekturwellen (2, 4) korrektiv (3er oder Kombination).
  Insbesondere ist **Welle 3 IMMER ein echter Impuls**. (Die früheren
  Diagonal-Regeln DG-1/DG-2/DG-3 sind ab v4.3 per Erlass VERWORFEN — das
  Modell zählt keine Diagonalen mehr; siehe §Diagonalen-Erlass.)

## 2. Diagonalen (Kanon; von der Engine noch nicht modelliert → §9)

- **DG-1** Ending Diagonal: Position Welle 5 oder C; Struktur 3-3-3-3-3;
  Keilform (2-4-Linie konvergiert zur 1-3-Linie); W4/W1-Overlap erlaubt;
  Throw-over über die 1-3-Linie möglich; danach scharfe Umkehr mindestens
  bis zum Diagonalen-Ursprung.
- **DG-2** Leading Diagonal: Position Welle 1 oder A; Struktur 5-3-5-3-5;
  Keilform; Overlap erlaubt; signalisiert Fortsetzung, nicht Ende.
- **DG-3** Expanding-Varianten (divergierende Begrenzungen) sind selten und
  nur mit klarer 3er-/5er-Substruktur zu akzeptieren.

## 3. Korrekturmuster (Kanon)

- **KO-1** Eine Korrektur endet nie mit einer sauberen Fünf: Eine 5-teilige
  Gegenbewegung ist A einer größeren Korrektur oder die 1 einer Umkehr.
- **KO-2** Zigzag (5-3-5): scharfe Korrektur; B retraced A typisch
  0,382–0,786; C überschreitet das A-Ende deutlich.
- **KO-3** Flat (3-3-5): B retraced mindestens ~0,9 von A (Definitionsmerkmal
  gegen Zigzag). Regular: B ≈ A-Ursprung, C knapp hinter A-Ende. Expanded
  (häufigste Form): B überschießt den A-Ursprung (typ. 1,236–1,382×A),
  C läuft substanziell über das A-Ende (typ. 1,618×A). Running: C verfehlt
  das A-Ende — nur in sehr starken Trends akzeptieren.
- **KO-4** Triangle (3-3-3-3-3, a–e): nur an Position 4, B oder als letztes
  X/Y-Segment; kontrahierend (Regelfall), Barrier oder expandierend (selten);
  danach Thrust in Trendrichtung, Größenordnung ≈ breitestes Dreiecksbein.
- **KO-5** Kombinationen (W-X-Y, selten W-X-Y-X-Z): Verkettung einfacher
  Dreier; Pflicht-Lesart für zähe Seitwärtsphasen, die sich weder als Impuls
  noch als einfacher Dreier zählen lassen. Höchstens ein Triangle, und nur
  als Schlussglied.
- **KO-6** Nach abgeschlossenem 5er-Zyklus folgt eine Korrektur desselben
  Grades; bevorzugte Zielregion ist das Gebiet der vorherigen Welle 4
  (die „W4-Zone").

## 4. Guidelines — Qualität, nicht Gültigkeit

- **GL-1 Extension:** Genau eine Antriebswelle ist gestreckt, meist Welle 3
  (Aktien/Krypto-Makro); gestreckte Erste sind bei Zyklusstarts von Tiefs
  häufig, gestreckte Fünfte in Rohstoffen.
- **GL-2 Alternation:** Welle 2 und Welle 4 unterscheiden sich in Form und
  Tiefe (scharf/tief vs. flach/seitwärts — typ. W2 0,5–0,786, W4 0,236–0,5).
- **GL-3 Gleichheit:** Von den nicht gestreckten Antriebswellen tendieren
  zwei zur Gleichheit oder 0,618-Relation (Log-Länge).
- **GL-4 Kanalisierung:** Impulse respektieren Parallelkanäle (0-2-Basislinie,
  Parallele durch 1 bzw. 3); W4 endet oft an der Basislinie; Throw-over der
  5 nur mit Momentum-Beleg belastbar.
- **GL-5 Volumen:** Welle 3 trägt das höchste Volumen; Preis-Neuhochs bei
  fallendem Volumen markieren Erschöpfung (typisch W5).
- **GL-6 Momentum-Divergenz:** Am W5-Extrem ist der Elliott-Oszillator
  (SMA5−SMA34) schwächer als am W3-Extrem — Lehrbuch-Bestätigung eines
  finalen Fünfers. Fehlende Divergenz ⇒ Verdacht, das vermeintliche W5 sei
  eine W3 höheren Grades.
- **GL-7 Fib-Zeit:** Wellen gleicher Funktion stehen zeitlich häufig in
  Fibonacci-Relation (Dauer W1↔W3↔W5, Korrekturdauer ↔ Impulsdauer).
- **GL-8 Wellen-Persönlichkeit (für den Kritiker):** W1 zweifelnd, W2
  pessimistisch-tief, W3 breit/nachrichtengetrieben/steil, W4 zäh und
  strukturarm, W5 eng geführt und divergent, B trügerisch („Bullenfalle"),
  C zerstörerisch und impulsiv.

## 5. Fibonacci-Relationen (Preis)

- **FB-1** W2-Retracement von W1: typisch 0,5–0,618 (akzeptabel 0,382–0,9).
- **FB-2** W4-Retracement von W3: typisch 0,236–0,382 (akzeptabel ≤ 0,5;
  Grenzfall 0,618 nur ohne Overlap).
- **FB-3** W3 = 1,618 oder 2,618 × W1, wenn W3 gestreckt ist.
- **FB-4** W5 = 1,0 × W1 oder 0,618 × W1; alternativ 0,618 × Strecke(0→3).
- **FB-5** Zigzag: C = 1,0 × A (Alternativen 0,618 / 1,618 / 1,236).
- **FB-6** Flat expanded: C = 1,618 × A (selten 2,618); B = 1,236–1,382 × A.
- **FB-7** Triangle: alternierende Beine ≈ 0,618 (kontrahierend) bzw.
  ≈ 1,618 (expandierend).
- **FB-8** Korrekturziele des Gesamtimpulses: Retracement-Band 0,382–0,886
  plus W4-Zone (KO-6); belastbar erst als **Konfluenz-Cluster** aus mehreren
  unabhängigen Herleitungen (Retracements ∧ C=k·A ∧ W4-Zone), beide
  Konventionen (linear und logarithmisch) zählen als eigene Herleitung.

## 6. Maschinelle Validierungs-Gesetze (VG) — was der Code erzwingt

- **VG-1 Chronologie:** Wellenpunkte streng aufsteigend nach Datum.
- **VG-2 Geometrie:** HR-1, HR-3, HR-4 vorzeichen-neutral geprüft
  (bullish/bearish über Richtungsfaktor); HR-2 in Log-Länge.
- **VG-3 Segment-Extrem** *(ersetzt das alte, unscharfe
  „Anti-Gravitationstief")*: Jeder Wellenpunkt ist das Extrem seines
  Segments — kein Pivot gleicher Art zwischen Nachbarwellen darf ihn
  überbieten; W5 bleibt Extrem aller nachfolgenden Impuls-Pivots.
- **VG-4 Pivot-Verankerung:** Wellenpunkte sind ausschließlich
  ZigZag-Pivots der jeweiligen Auflösungsstufe.
- **VG-5 Vollständigkeit & Konsistenz:** Eine Zählung enthält stets die
  Punkte 0–5; Korrektur-Labels (A/B/C, W/X/Y) nur nach Welle 5; das
  trend-Feld entspricht der Impulsrichtung (W5 vs. W0).

## 7. Engine-Doktrin (DK) — Policy, bewusst strenger als der Kanon

- **DK-1 Säkularer Anker:** Welle 0 liegt am globalen Extrem des
  Analysefensters (Default: 5 Jahre Weekly). Mehrjährige exponentielle
  Anstiege werden als 5er-Zyklus gezählt, nie als ABC aufwärts; historische
  Crashs sind Makro-W2/W4.
- **DK-2 Log-Messung:** Wellenlängen mehrjähriger Bewegungen werden
  logarithmisch verglichen (HR-2, GL-1, GL-3). Gilt auch für projizierte
  Extension-ZIELE der Korrektur (KO-Ziele als logC=k·A, V117.2); die
  Klassifikations-Ratios der Muster (KO-2/KO-3-Bänder) bleiben als
  kanonische Preis-Definitionen linear.
- **DK-3 Trunkierungsverbot (Policy):** Der Kanon erlaubt seltene
  Trunkierungen; die Engine schließt sie aus und bevorzugt stattdessen den
  früher endenden Impuls (das vermeintliche W3-Extrem *ist* dann W5).
  Begründung: Trunkierung ist ex ante nicht von einer laufenden B-Welle
  unterscheidbar — Verwechslungskosten > Erkennungsnutzen.
- **DK-4 Auflösungs-Leiter (Best-über-Stufen):** ZigZag-Stufen
  25/18/12/8 % werden ALLE ausgewertet; unter den Doktrin-Treffern gewinnt
  der höchste Score (bei Gleichstand die gröbere Stufe). Fallback-Anker
  kommen nur ohne jeden Doktrin-Treffer zum Zug (Schwelle DK-7).
  Sub-Analysen (GL-6/§Substruktur) nutzen relativ feinere Stufen.
- **DK-5 Konfluenz- & Nachweis-Pflicht:** Kein Signal ohne
  Fibonacci-Herleitung, kein Setup ohne Invalidierungslevel, kein Cluster
  mit Score < 2; Bestätigung ausschließlich per Wochenschluss über dem
  Trigger (State Machine PENDING → CONFIRMED/INVALIDATED/TIMEOUT).
- **DK-7 Enthaltungs-Gebot:** Lieber keine Zählung als eine erzwungene.
  Fallback-Anker-Zählungen unterhalb Score 8/12 werden verworfen; die
  Engine meldet Enthaltung mit Begründung und liefert den nackten
  Preischart. Doktrin-Anker-Zählungen bleiben stets gültig (harte Regeln
  am Fenster-Extrem bestanden). Motivation: PYPL-Fall — der eigene
  Kritiker urteilte „Zählung wirkt erzwungen".
- **DK-9 Vollendungs-Nachweis:** Der 0-5-Finder erklärt die letzte Spitze
  qua VG-3 zwangsläufig zur Welle 5 - er kann strukturell nur "fertig".
  Eine unabhängige Sub-Zählung des W4→W5-Segments prüft daher, ob Welle 5
  binnenstrukturell abgeschlossen ist (kompletter Sub-5-Teiler → Korrektur
  wahrscheinlich) oder noch läuft (Teilsequenz Sub-1/Sub-3/Sub-4 → nächste
  Welle wird per Fibonacci projiziert, Log-Raum). Rein diagnostisch: ändert
  die 0-5-Zählung nicht, ergänzt sie um Status und Kursziele.
  **Prämisse (v4.6):** "Welle 5 läuft noch" ist nur haltbar, solange der
  Kurs noch am W5-Extrem steht UND keine Korrektur ab W5 ausgebildet ist.
  Sobald eine A-B-C/W-X-Y-Struktur ab W5 vorliegt oder der Kurs sich > 0,15
  (log) von W5 entfernt hat, IST Welle 5 abgeschlossen — DK-9 schweigt, die
  Korrektur-Lesart hat Vorrang. Verhindert den Selbst-Widerspruch "Chart
  zeigt fertige 5 + laufende Korrektur, Text sagt 5 läuft noch".
- **DK-8 (zurückgezogen v4.3):** Das Diagonal-W3-Gate entfällt mit dem
  Diagonalen-Erlass. `segmentVerdict` kennt nur noch IMPULSIVE/UNKLAR;
  Welle-3-Impulsivität wird weiter geprüft, aber nicht mehr über einen
  Keil-Ausschluss.

- **DK-6 Kritiker-Asymmetrie:** LLM-Review (Confidence/Flags) darf
  Anforderungen nur verschärfen, nie lockern — und nie die Zählung ändern.
  Seine Güte wird über Confidence-Bänder in der OKF-Statistik gemessen.

## 8. Trace-Matrix (Regel → Implementierung)

| Regel | Implementierung |
|---|---|
| HR-1, HR-3, HR-4 | `impulseFinder.searchFromAnchor` (Konstruktionsbedingungen) |
| HR-2 | `impulseFinder` (L3 nie kürzeste, Log-Länge) |
| HR-5 | `impulseFinder.segmentVerdict` (IMPULSIVE/UNKLAR); positionsbewusst in `quality` |
| DG-1 | `diagonal.detectDiagonal` — Einsatz: W5-Substruktur (`quality`) und C-Welle (`engine`, Flag `ED_IN_C_TERMINAL`) |
| DG-2 | Detektor geometrisch identisch vorhanden; Positions-Einsatz an W1/A **offen** (§9) |
| DG-3 | **offen** (§9, expandierende Variante) |
| KO-2/KO-3-Klassifikation | `correction.classifyCorrection` (B/A-Ratio) + KO-Ziel-Injektion in die Cluster-Kandidaten; A/B/C-Beine: `engine.correctionLegs` |
| KO-4 | teilw.: Triangle-**Verdacht** in `correction.classifyCorrection` (Vollklassifikation §9) |
| KO-6 / FB-8 | `fibCluster.longLevelCandidates` + `clusterLevels` (dual, ATR-adaptiv) |
| GL-1, GL-2, GL-3, FB-1, FB-2 | `impulseFinder.scoreImpulse` (Scoring) |
| GL-4 | `quality.assessQuality` (W4 an 0-2-Basislinie, Log-Raum) |
| GL-5 | `quality.assessQuality` (W3-Volumendominanz; Yahoo-Weekly-Volumen) |
| GL-7 | `quality.assessQuality` (Dauer-Relationen W1/W3/W5, Bonus ohne Flag) |
| GL-6 | `quality.assessQuality` (Oszillator-Divergenz) |
| FB-5/FB-6-Projektionen | `fibCluster` (C = k·A, linear + log) |
| VG-1…VG-3 | `impulseFinder` (Reihenfolge, Geometrie, Segment-Extreme) |
| VG-4 | `zigzag` + Finder-Konstruktion |
| VG-5 | konstruktiv erfüllt (Finder erzeugt stets 0–5) |
| DK-1…DK-4 | `impulseFinder` (Anker, Log, No-Trunc, `findImpulseAdaptive`) |
| DK-5 | `engine` (Long- & Short-Zweig) + `setups`/`outcome` (richtungsbewusste State Machine, 84d-Timeout) |
| DK-7 | `impulseFinder.findImpulseAdaptive` (MIN_FALLBACK_SCORE) + Enthaltungs-Modus in `engine`/`commands` |
| KO-1…6 | `correction.classifyCorrection` (Struktur-Beweis + Ratio-Bänder + Log-Ziele) |
| DK-9 | `completion.assessCompletion` + `impulseFinder.findPartialImpulse`; Anzeige in `engine` |
| DK-6 | `commentary.getCritique` + `engine` (minClusterScore) + `stats` (Bänder) |

## 9. Offene Prüfungen (Roadmap)

1. **Leading-Diagonal-Einsatz** (DG-2): Detektor an Position W1/A nutzen,
   um frische Umkehrungen ab Cluster-Tiefs früh zu erkennen; **DG-3**
   (expandierend) ergänzen.
2. **Triangle-Vollklassifikation & Running Flat** (KO-3/KO-4): aus dem
   Verdachts-Hinweis eine belastbare a–e-Zählung mit Thrust-Projektion
   machen; Running Flat erst nach Abschluss klassifizierbar.
3. **Kanal-Projektion** (GL-4): aktuell nur W4-Basislinien-Check —
   W5-Zielprojektion über die 2-4-Parallele ergänzen.

---
*Kanon-Referenzen: Elliott (1938), Frost/Prechter „Elliott Wave Principle".
Abweichungen der Engine vom Kanon sind ausschließlich in §7 (DK) kodifiziert.*


---

## V120-Ergänzungen (Koenz/EWI-Abgleich)

- **HR-6 W4-Retracement-Grenze:** Welle 4 retraced nie mehr als 0,618 der
  Welle 3 (LINEAR gemessen — Preisregel, bewusst nicht Log; vgl. DK-2).
  Kandidaten darüber werden im Finder verworfen.
- **GL-2b typabhängige Bänder (nur Qualitäts-Ebene):** Ext-W1: W2/W4
  üblich 0,236–0,382 (flach); Ext-W3/W5: klassisch. WICHTIG: Die Bänder
  wirken als Qualitäts-Info („Retrace-Typ ✓/~"), NICHT im Selektions-
  Scoring — der Walk-Forward (8 Symbole, 10 J.) zeigte dort eine
  Expectancy-Verschlechterung 5,0→3,3 % (Score≥3: 12,6→6,1 %).
- **GL-5/GL-6 typbewusst:** Volumen-Maximum liegt in der GESTRECKTEN Welle
  (Ext-W1: W1-Dominanz; Ext-W5: steigendes Profil, W5-Maximum). Bei Ext-W5
  ist fehlende W5-Divergenz ERWARTBAR — kein Flag, keine Wertung.
  Flag umbenannt: VOLUMEN_W3_SCHWACH → VOLUMEN_PROFIL_ATYPISCH.
- **GL-7 NEU (Fib-Zeit-Bänder):** Wahrscheinlichkeits-Bänder je Wellenpaar
  statt grobem Fib-Set: t(W2)/t(W1) üblich 0,382–2,0 (≥4,0 →
  ZEIT_W2_ATYPISCH); Zeit-Alternation t(W4)/t(W2) ≥ 1,0 üblich (≥5,0 →
  ZEIT_W4_ATYPISCH); t(W5)/t(W1) 0,618–1,618 NUR bei Ext-W3 vergleichbar.
  Dazu ZEITFENSTER-PROJEKTION: C-Ende üblich 0,618–1,618 Fib-Zeit von A
  (ab B-Ende); laufende Sub-Wellen erhalten Zeitfenster analog
  (Sub-2: 0,382–2,0×t(Sub-1); Sub-4: 1,0–3,0×t(Sub-2)) — als vertikale
  Bänder im Chart und in der Lesart (Zeit-Preis-Konfluenz).
- **DG-1 auf EWI-Stand:** „W3 < W1" gestrichen (Guideline, Feld w3Shorter);
  1/4-Overlap von Regel zu GUIDELINE herabgestuft (Feld overlap). Harte
  Regeln bleiben: W5 < W3 und W4 < W2 (Länge). Zusätzlich Koenz'
  Kanal-Touch: berührt W4 die Parallele zur 1-3-Linie durch W2, ist die
  Diagonale invalidiert. SELEKTIONS-Wirkung (DK-8-Verdikt, Completion-
  COMPLETE) bleibt dem kanonisch STARKEN Keil (mit Overlap) vorbehalten;
  Overlap-lose Keile sind Guideline-Hinweise.

- **DK-10 Setup-Gates (V121, messbasiert):** (a) Neue PENDINGs verlangen
  Cluster-Score ≥ 3 (Walk-Forward: ~10,7 % vs 2,4 % Expectancy); Score-2-
  Zonen werden als 🟡 WATCH gemeldet. (b) Zeit-KONFLUENZ (kein Gate): Das
  C-Zeitfenster (0,618–1,618 Fib-Zeit von A ab B-Ende) wird an jedem
  PENDING als ⏱️-Status ausgewiesen und im Walk-Forward als Subgruppe
  gemessen. Als HARTES Gate gemessen verworfen: n=3 statt 17,
  Expectancy 10,7 % → 0,4 % — Zeit ist Wahrscheinlichkeit, nicht
  Erlaubnis. (c) Ziel-Guard: CONFIRMED erzeugt nur dann einen
  Trade, wenn das Restpotenzial ≥ 0,25R beträgt — sonst ⚠️ „CONFIRMED ohne
  Trade" (degeneriertes Setup).

- **HR-6 (V123 präzisiert):** Die 0,618-W4-Grenze wird im Doktrin-Messraum
  geprüft (LOG, DK-2). Die lineare Lesart verwarf kanonische
  Makro-Zählungen (BTC-Superzyklus: W4 2022 linear 0,81, log 0,48).
- **HR-7 Grad-Konsistenz (V123):** Preis-Obergrenze 4,236× (log) für die
  längste vs. zweitlängste Antriebswelle. Zusätzlich Preis×Zeit: Übertrifft
  die längste Welle die zweitlängste im Preis um > 2,0× UND in der Dauer
  um > 4,236×, liegt Grad-Vermischung vor (Befund BTC `max`: 0–4 als
  Randstaub, „W5" = ganze Dekade). Eine echte Extension streckt den Preis,
  nicht den Wellengrad.


---

## Korrektur-Vollkatalog (KO, v4.3)

Alle theoretischen Korrekturmuster, ihre Erkennung und Ziele. Klassifikation
über Ratio-Bänder (linear, kanonische Preis-Definitionen) PLUS
**Struktur-Beweis** (KO-1). Extension-Ziele logarithmisch projiziert (DK-2).
Implementiert in `core/correction.ts` (`classifyCorrection`), gerendert in
`engine`/`drawer`.

- **KO-1 Struktur-Beweis (Basis, v4.7 verschärft):** Das A-Bein wird per
  `segmentVerdict` geprüft. Impulsiver 5er ⇒ **Zigzag-Familie**; 3er/unklar
  ⇒ **Flat-Familie**. In der Grauzone (B-Retrace 0,786–0,9) entscheidet
  allein die A-Struktur (Koenz: 0,886-Touch spricht für korrektiv/Flat).
  **Auflösungs-Fix (v4.7):** `segmentVerdict` nutzt absolute feine Sub-Stufen
  (12/8/5 %), nicht nur parent-relative — ein kurzes, steiles Bein wurde
  sonst mangels Pivots fälschlich "unklar". **Geradlinigkeits-Fallback:**
  ist ein Segment zu kurz für eine 5er-Zählung, aber geradlinig in
  Trendrichtung (Effizienz Netto/Brutto-Log ≥ 0,7, gleichgerichtete Kerzen
  ≥ 70 %), gilt es als impulsiv (ein Korrektiv wäre verwinkelt).
- **KO-1b A-B-C-Segmentierung (v4.7):** Die Korrektur-Beine sind die ERSTE
  vollständige A-B-C-Sequenz (A = erstes markantes Pivot nach dem Impuls,
  B = erstes Gegen-Pivot, C = nächstes Pivot), NICHT globale Extrema. Das
  alte "B = global tiefstes/höchstes Extrem" presste ganze Auf-Ab-Zyklen in
  ein A-B (CRCL: A=136 → B=58 statt korrekt A=136 → B=84 → C läuft).
- **KO-2 Zigzag (5-3-5):** B retraced A 0,382–0,786. C-Ziele
  logC = 1,0 / 1,236 / 1,618 · A (ab B).
- **KO-2b Double Zigzag (W-X-Y):** Zigzag-Basis, aber C überschießt > 1,75×A
  (X-Welle dazwischen). Ziele logC = 2,0 / 2,618 · A.
- **KO-3 Flat (3-3-5):** B retraced A ≥ 0,9. **Regular** (B ≈ A, 0,9–1,05;
  Ziele 1,0/1,236) vs. **Expanded** (B > 1,05; Ziele 1,618/2,0/2,618).
  Warnung ab B ≥ 1,618×A (Wahrscheinlichkeit sinkt deutlich).
- **KO-4 Running Flat:** B überschießt (Flat-Kriterium), C hält aber DEUTLICH
  über dem A-Extrem (cOverA 0,1–0,85, Kurs trendseitig) — trendstärkstes
  Korrekturmuster, kein klassisches Abwärtsziel (Fortsetzung erwartet).
- **KO-5 Triangle (3-3-3-3-3):** Ab B ≥ 4 alternierende, monoton (log)
  kontrahierende Beine. Kein C-Ziel, sondern **Thrust-Ziel** = Höhe des
  a-Beins (log) ab e-Ende in Ausbruchsrichtung.
- **KO-6 Kombination W-X-Y (Vollmuster, v4.4):** Der Struktur-Beweis am
  ersten Korrektur-Bein entscheidet ABC vs. WXY. Ist das erste Bein (W)
  selbst NICHT impulsiv (3er statt 5er) und substanziell (≥ 6 Kerzen),
  liegt eine zusammengesetzte Korrektur vor: W (Zigzag/Flat) – X
  (Verbindung, Retrace 0,786–1,382 üblich) – Y (Zigzag/Flat). Die
  Strukturpunkte werden als **W-X-Y** im Chart gelabelt (statt A-B-C),
  Ziel logY = 1,0 / 1,236 / 1,618 × W (ab X), typischerweise
  längengleich (Y ≈ W). Impulsives erstes Bein ⇒ echtes ABC (Zigzag),
  bleibt bei KO-2. **Damit ist WXY eine vollwertige, unterscheidbare
  Lesart, nicht nur ein Etikett.**

**Bewusst nicht als eigenes Muster geführt:** Triple Zigzag / Triple Three
(seltener Grenzfall — würde als DOUBLE_ZIGZAG bzw. KOMBINATION erfasst und
über den laufenden C-Wert weiterprojiziert); exakte Triangle-Untertypen
(ascending/descending/expanding — als kontrahierend generalisiert, Thrust
identisch).

---

## Diagonalen-Erlass (v4.3)

Diagonalmuster (Leading/Ending Diagonal, expandierende Diagonalen) werden
**nicht mehr gezählt**. Motivation: wiederkehrende Fehlklassifikation an
Zyklusenden und Grad-Grenzen; die Diagonal-Geometrie ist im deterministischen
Rahmen zu fragil. `core/diagonal.ts` ist ein leerer Stub; `segmentVerdict`
liefert nur IMPULSIVE/UNKLAR; DG-1/2/3 und DK-8 sind zurückgezogen; die
Completion-Analyse kennt keinen ED-Zweig mehr (nur Sub-5-Teiler oder
laufende Teilsequenz).

- **Tageskerzen-Modus (v4.8):** `/analyse SYMBOL 1d [range]` rendert echte
  OHLC-Candlesticks (grün/rot) statt der Wochen-Schluss-Linie; Default-Range
  bei 1d ist 1y. Der Chart wird per candlestick-Flag durch die Kette
  commands → engine → chart → drawer gesteuert.
- **OFFEN (Expanded-Flat-Segmentierung):** Schiesst innerhalb der Korrektur
  ein zweites Hoch über das erste (überschießendes B eines Expanded Flat,
  z.B. CRCL 136 → Zwischentief → 140 → 5-teiliger Abstieg), segmentiert die
  Leg-Bestimmung dies noch als separate A-B-C statt als ein Flat mit
  überschossenem B. Ein erster Fix-Versuch (V129) erzeugte negative
  Ratios und wurde zurückgerollt; erfordert saubere a-b-c-Binnenstruktur-
  Herleitung des Flats, nicht bloßes Pivot-Umlabeling.
- **KO-7 Umschlag ABC → 1-2 (v4.9):** Entscheidet, ob eine Gegenbewegung
  noch Korrektur (A-B-C, alter Trend setzt sich fort) oder Beginn eines
  neuen Impulses (Welle 1-2, Trendwechsel) ist. Gemessen am Log-Retrace der
  Gegenbewegung relativ zum vorangegangenen Impuls, in Gegenrichtung:
  - **NONE** (< 61,8 %): normale Korrektur, A-B-C bleibt.
  - **WATCH** (≥ 61,8 %): 👁️ Beobachtung — Trigger ist das Überschreiten des
    Impuls-Ursprungs; kippt dann zu 1-2.
  - **LIKELY** (≥ 78,6 % UND Gegenbewegung strukturell impulsiv/5er): 🔄
    Umschlag wahrscheinlich — Gegenbewegung ist vermutlich Welle 1, nicht A.
  - **CONFIRMED** (Retrace > 100 %, Impuls-Ursprung überschritten): 🔄
    Trendwechsel — A-B-C ausgeschlossen (eine Korrektur überschreitet den
    Ursprung nie), die Bewegung ab dem Extrem ist Welle 1, die Reaktion
    Welle 2. Rein diagnostisch (kein Eingriff in Zählung/Selektion); erscheint
    in Korrektur-Lesart und Big Picture.
- **Rahmen-Transparenz (v5.0):** Die Korrektur-Bewertung (Muster UND Ziele)
  hängt vom Analyserahmen ab — Fenster (5y/10y/max) und Auflösung (1d/1w)
  bestimmen den Wellengrad, an dem gemessen wird. Elliott ist fraktal:
  dieselben Kerzen ergeben bei anderem Ursprung eine andere B/A-Ratio, einen
  anderen Struktur-Beweis am A-Bein und damit eine andere Lesart (z.B. BTC:
  5y → Zigzag/unklar mit Impuls 15.599→126k; 10y → W-X-Y mit Impuls
  531→126k). Das ist KEINE Inkonsistenz, sondern echte Grad-Information. Die
  Ziele sind INNERHALB eines Rahmens konsistent zur Lesart (Zigzag → KO-2-
  Bänder; W-X-Y → tiefere KO-6b-Bänder). Der Report weist den geltenden
  Rahmen jetzt explizit aus (ℹ️-Hinweis), damit verschiedene Bewertungen
  nicht als Widerspruch missverstanden werden. Auf feinerer Auflösung
  erscheint dasselbe Bein oft verwinkelter (niedrigere Effizienz im
  Struktur-Beweis) — ebenfalls echte fraktale Information.
- **KF-1 Multi-Timeframe-Konfluenz (v5.1, still):** Jede Wochen-Analyse
  validiert sich zusätzlich still auf der Tagesebene (Woche → Tag). Die
  tiefere Zählung wird NICHT ausgegeben — nur ein Konfluenz-Verdikt.
  Definition von "gleiches Ergebnis": die aktuell laufende Welle der
  Hauptebene muss sich auf der Tagesebene in ihre erwartete Substruktur
  zerlegen lassen (verschachtelt):
  - Hauptebene "Welle 5 läuft" (IMPULS) → Tagesebene sollte gleichgerichteten
    Impuls zeigen.
  - Hauptebene "Korrektur läuft" → Tagesebene sollte GEGENläufigen Impuls
    zeigen (Korrektur oben = Impuls unten).
  Verdikte: **✅ BESTÄTIGT** (Substruktur passt), **◽ NEUTRAL** (Tagesebene
  ohne klare Zählung/zu wenig Daten), **⚡ FRÜHWARNUNG** (Tagesebene läuft
  strukturell voraus — z.B. dreht gegen die noch laufende Welle 5, oder
  Korrektur unten ist bereits abgeschlossen). Bei Widerspruch bleibt die
  HAUPTZÄHLUNG bestehen; die Tagesebene dient nur als Frühwarnung (im Big
  Picture und Detail-Block). Nur Woche→Tag (robusteste Daten); der
  Tages-Modus selbst löst keine Konfluenz aus (keine Rekursion).