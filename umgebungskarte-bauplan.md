# Bauplan: Umgebungskarte ("Was ist in der Nähe?") mit Concierge-Anbindung

Stand: 15.07.2026 · Feature-Idee aus der mapcn-Evaluation (github.com/AnmolSaini16/mapcn).
Der Gast fragt den Concierge "Wo ist der nächste Supermarkt?" — die Antwort kommt im Chat
UND eine Karte öffnet sich, fliegt zur Wohnung und zeichnet animiert den Fußweg zum
Supermarkt, mit Gehzeit als Label. Kein anderer Makler-Auftritt hat das.

**Legende:** `DU` = Hauke klickt/führt aus · `ICH` = Claude liefert Code/Skripte/Texte

---

## Vorab geklärt: Machbarkeit + Technologie-Entscheidung

**Ist die Weg-Animation überhaupt möglich?** Ja. mapcn liefert `MapRoute` (statische
Linie) und `flyTo` (Kameraflug), aber KEINE eingebaute progressive Routen-Animation.
Die Animation ist trotzdem einfach: Die Route wird als wachsende Koordinaten-Liste
pro Animation-Frame in die MapLibre-GeoJSON-Quelle geschrieben — der Weg "zeichnet
sich" vom Haus zum Ziel. mapcns eigener Delivery-Tracker-Block macht Ähnliches statisch.

**Warum NICHT mapcn selbst, sondern MapLibre GL direkt:** mapcn ist eine reine
React-Komponentenschicht — unser Viewer ist aber Vanilla-TypeScript (PlayCanvas
supersplat-Fork, kein React). React nur für eine Karte in den Viewer zu mounten
wäre Ballast ohne Nutzen. mapcn nutzt unter der Haube MapLibre GL, und ALLE
relevanten Fähigkeiten (flyTo, Routen, Marker, Popups) sind MapLibre-Kern.
→ Wir bauen mit **MapLibre GL direkt** und übernehmen mapcns Design-Sprache
(dezente Marker, Tooltips, dunkle/helle Kartenstile) in unserem innsyn-Look.

**Tile-Lizenz (erledigt 16.07.2026):** Kartenkacheln kommen von MapTiler
(Free-Plan, Account haukecux19@gmail.com, ~100k Aufrufe/Monat, kommerziell
erlaubt, MapTiler-Attribution läuft über maplibre automatisch). Der Key ist
ein öffentlicher Client-Key, geschützt über die Allowed-HTTP-Origins-Liste
im MapTiler-Dashboard (myinnsyn.de, *.myinnsyn.de, localhost, *.vercel.app) —
NICHT über Geheimhaltung. Style: "dataviz" (hell, ruhig), als
DEFAULT_STYLE_URL in surroundings.ts; settings.surroundings.styleUrl bleibt
als Override pro Szene. Bei Key-Missbrauch: neuen Key anlegen, alten löschen.

---

## Teil 1: Daten-Pipeline (einmalig pro Objekt)

**Wofür:** Die Karte braucht pro Objekt: Koordinaten der Wohnung + die nächsten
Orte (Supermarkt, Bäcker, Schule, Kita, U-Bahn, Apotheke, Park) mit echtem
Fußweg und Gehzeit. Das wird EINMAL beim Anlegen des Objekts berechnet, nicht
live im Browser — schnell, offlinefähig, keine Laufzeit-Abhängigkeit.

- [x] **1.1 Script `apps/viewer/scripts/fetch-surroundings.mjs`** · `ICH`
  - Input: Koordinaten + gewünschte Kategorien.
  - *Technik:* Overpass API (OpenStreetMap-Datenbank, kostenlos) findet je Kategorie
    den nächstgelegenen Ort im Umkreis; OSRM-Fußrouting (routing.openstreetmap.de,
    kostenlos, faire Nutzung — wir fragen einmalig pro Objekt, nicht pro Besucher)
    liefert Routen-Geometrie + Gehminuten. Output: fertiger `surroundings`-Block.
- [x] **1.2 Demo-Daten für altbau-eppendorf erzeugen** · `ICH`
  - Demo-Standort Eppendorf (Hamburg), Ergebnis in beide settings.json
    (Viewer + Website-Kopie) und in die Concierge-Wissensbasis.

## Teil 2: Viewer — das Karten-Overlay

**Wofür:** Der sichtbare Teil. Ein "Umgebung"-Knopf im Viewer öffnet ein
Overlay-Panel im Stil des Chat-Panels: Karte, Haus-Marker, unten Kategorie-Chips
("Supermarkt · 4 Min", "U-Bahn · 6 Min", …). Tipp auf einen Chip → Kamera fliegt,
Route zeichnet sich animiert, Gehzeit erscheint am Ziel.

- [x] **2.1 `maplibre-gl` als Dependency + CSS-Kopie im Rollup-Build** · `ICH`
  - *Technik:* MapLibre wird per dynamischem `import()` erst geladen, wenn die
    Karte zum ersten Mal geöffnet wird (~250 KB) — der 3D-Viewer-Start bleibt
    unberührt. Rollup baut mit `format: esm` automatisch einen eigenen Chunk.
- [x] **2.2 Modul `apps/viewer/src/surroundings.ts`** · `ICH`
  - Panel-DOM in index.html, Styles in index.scss (dark-glass wie Chat).
  - Haus-Marker (innsyn-Stil), POI-Marker, Chips, flyTo + Routen-Animation
    (requestAnimationFrame, wachsende Linie), Gehzeit-Label.
  - Ohne `surroundings`-Block in settings.json bleibt alles unsichtbar —
    gleiche Absicherung wie beim Concierge (kein toter Knopf).
- [x] **2.3 Settings-Schema erweitern** · `ICH`
  - `surroundings: { center, styleUrl?, pois: [{ id, label, category, lngLat,
    walkMinutes, route }] }`

## Teil 3: Concierge-Verzahnung (der Wow-Moment)

**Wofür:** Die Frage "Gibt's hier einen Supermarkt?" beantwortet der Concierge
mit echten Daten ("Ja, EDEKA, 4 Minuten zu Fuß") und öffnet dabei die Karte
mit der Animation. Gleicher Mechanismus wie der bestehende Kamera-`focus`.

- [x] **3.1 Wissensbasis-Schema + Daten** · `ICH`
  - `knowledge.ts` validiert optionalen `surroundings`-Block; die Umgebungs-Fakten
    (Name, Kategorie, Gehminuten) wandern in den System-Prompt.
- [x] **3.2 Strukturierte Antwort erweitern** · `ICH`
  - *Technik:* Das Antwort-JSON `{ answer, focus, fallback }` bekommt ein viertes
    Feld `mapPoi`. Wie bei `focus` gilt: Nur IDs, die es wirklich gibt, werden
    akzeptiert — das Modell kann nichts erfinden.
- [x] **3.3 Client-Verdrahtung in `concierge.ts`** · `ICH`
  - `mapPoi` in der Antwort → Event `surroundings:show` → Karte öffnet + animiert.
  - Mobile Sonderfall: Die ausgelagerte chat.html zeigt die Gehzeit nur im Text
    (Karte lebt im Viewer; Rücksprung-Deep-Link wäre ein späterer Ausbau).

## Teil 4: Tests + lokale Verifikation

- [x] **4.1 Vitest** · `ICH` · KB-Validierung (surroundings) + mapPoi-Parsing
  (nur bekannte IDs) analog zu den bestehenden validation-Tests.
- [x] **4.2 Lokal testen vor Push** · `ICH` · Viewer bauen, Karte im Browser
  öffnen, Chip-Animation + Concierge-Trigger prüfen (Regel: local test before push).

## Teil 5: Adresssuche + drei Verkehrsmittel (nachgereicht 16.07.)

**Wofür:** "Wie lange brauche ich zur Arbeit?" — der Gast tippt eine beliebige
Adresse und sieht Zeiten für Zu Fuß, Auto und Bahn & Bus, mit gezeichneter Route.

- [x] **5.1 Adresssuche** · `ICH` · Photon-Geocoding (OSM, kostenlos) mit
  Vervollständigung, Umkreis-Bevorzugung, Duplikat-Filter. Enter = erster Treffer.
- [x] **5.2 Drei Modi** · `ICH`
  - *Technik:* Zu Fuß + Auto über OSRM (zwei Profile desselben Dienstes;
    Auto = Freifluss ohne Verkehrslage). ÖPNV über **Transitous** (offene
    MOTIS-Instanz über die offiziellen DELFI-Fahrplandaten, HVV komplett).
    Deren Koordinaten-Routing ist unzuverlässig → `radius`-Parameter nutzt
    Haltestellen im Umkreis als Einstieg, die fehlende erste/letzte Meile
    wird per OSRM-Fußweg ergänzt — die Tür-zu-Tür-Minuten bleiben ehrlich.
  - Nachts (21-6 Uhr) wird für den nächsten Morgen 08:30 geplant, damit keine
    Nachtbus-Zeiten als Normalfall erscheinen.
  - Label nennt die Linien ("29 Min. · U1"); Pills füllen sich unabhängig,
    sobald jeder Dienst antwortet.
- [x] **5.3 Robustheit** · `ICH` · Routen-Zeichnung hängt nicht mehr am
  fragilen moveend-Event (Timer-Fallback); ResizeObserver heilt die Karte,
  wenn sie während eines Layout-Übergangs initialisiert wurde.

**Datenschutz-Hinweis für Livegang:** Die getippte Adresse geht live an
Photon/OSRM/Transitous (alle OSM-Ökosystem, kein Google). Muss in die
Datenschutzerklärung — oder die Aufrufe wandern hinter unseren Worker.
Getrackt wird nur DASS gesucht wurde, nie die Adresse.

## Teil 6: Concierge-Ortssuche — "Wo ist der nächste MediaMarkt?" (nachgereicht 16.07.)

**Wofür:** Fragen nach Orten, die NICHT im Exposé stehen, konnte der Concierge
bisher nur mit dem Makler-Fallback beantworten. Jetzt hat er ein Werkzeug.

- [x] **6.1 Tool Use im Worker** · `ICH`
  - *Technik:* Claude bekommt ein `find_place`-Werkzeug (Anthropic Tool Use).
    Bei einer Ortsfrage ruft es das Modell auf, der Worker sucht serverseitig
    (Namen/Marken über Photon, Gattungen wie "Fitnessstudio" über Overpass-
    Kategoriensuche im 3-km-Umkreis, mit Spiegel-Server als Ausfallschutz),
    ergänzt echte Geh-/Fahrminuten per OSRM und reicht das Ergebnis in einer
    zweiten Modellrunde zurück. Das Modell kann NUR aus dem Werkzeugergebnis
    antworten — nichts erfinden. Findet das Werkzeug nichts: Makler-Fallback.
  - Voraussetzung: `location` (Koordinaten) in der Wissensbasis — ohne sie
    wird das Werkzeug gar nicht angeboten.
  - Kosten: Ortsfragen brauchen 2 statt 1 Claude-Aufruf (~2-4 s Antwortzeit).
- [x] **6.2 Karte öffnet sich cineastisch** · `ICH`
  - Antwort trägt `mapPlace` (Name, Adresse, Koordinaten) → der Viewer blendet
    das Karten-Panel mit federnder Zoom-Animation ein, füllt die Adresssuche,
    und die drei Verkehrsmittel-Pills + Routenzeichnung laufen wie bei einer
    manuellen Suche. Verifiziert: "Wo ist der nächste MediaMarkt?" → Antwort
    "Nedderfeld 70, 27 Gehminuten / 4 Autominuten" + Karte mit Route.

## Später (bewusst NICHT jetzt)

- ~~Tile-Anbieter-Wechsel auf MapTiler/Stadia beim Livegang~~ → erledigt
  16.07.2026, MapTiler Free (siehe Tile-Lizenz-Abschnitt oben).
- "Lage"-Sektion auf der Website-Property-Seite (dort ist React — mapcn passt
  direkt, gleiche Daten).
- Kategorien-Feintuning pro Objekt (welche 6 Chips zeigt ein Objekt in Winterhude
  vs. eines in Blankenese).
