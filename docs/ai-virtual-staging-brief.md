# Feature-Briefing: KI-Möblierung / Virtual Staging ("AI Reframe")

> Handoff-Dokument für eine frische Session. Selbst-erklärend. Ziel: dieses Feature
> als MVP in StepInside integrieren. Vorbild ist das "AI Reframe" von Real Horizons.

## 1. Ziel in einem Satz

Im StepInside-Viewer soll man eine **leere** Raumansicht in eine **möblierte** Ansicht
verwandeln können: Standpunkt rendern -> an ein KI-Bildmodell schicken -> fotorealistisch
möbliertes Bild zurück -> im Viewer als Möbliert-Ansicht zeigen, wegklickbar zurück zum
Walken.

## 2. Wie es technisch funktioniert (die Kette)

1. Aktuellen Blickwinkel aus dem PlayCanvas-Splat als **2D-Bild** rendern (Canvas-Frame),
   plus **Kamera-Pose** merken (Position, Rotation, FOV).
2. Bild + Stil-Prompt (+ optionale Referenzbilder) **serverseitig** an das Bildmodell schicken.
3. Modell gibt ein gestyltes, möbliertes Bild zurück.
4. Bild **speichern**, verknüpft mit Szene + Kamera-Pose.
5. Im Viewer: Kamera **einfrieren**, Bild **sanft einblenden** als Overlay. Wegklicken ->
   zurück im lebenden Splat, exakt an derselben Stelle.

**Wichtig:** Das Bildmodell bekommt NICHT das Splat (3D). Es bekommt ein flaches Bild und
gibt ein flaches Bild zurück. Es ist reines Bild-zu-Bild.

## 3. Produkt-Entscheidungen (so wurde es festgelegt)

- **MVP = vorgepinnte Standpunkte** (nicht Live-on-demand). Pro Raum 1-4 kuratierte
  Standpunkte vorab generieren, **vom Menschen geprüft**, beim Antippen sofort anzeigen.
  Vorteile: kein Warten, kontrollierte Qualität, kalkulierbare Kosten, kein KI-Müll live.
- **Ein Winkel pro Raum.** Reine 2D-KI kann Möbel NICHT konsistent über mehrere Winkel
  halten (jeder Aufruf erfindet andere Möbel). Also pro Standpunkt ein eigenes, kuratiertes
  Standbild. NICHT als konsistente Mehrwinkel-Möblierung verkaufen.
- **Es ist ein Standbild, kein begehbares möbliertes 3D.** So kommunizieren und verkaufen.
- **Mehrere Stile** sind das Verkaufsargument (skandinavisch / klassisch / modern). Stil =
  austauschbarer Prompt-Block. Idee: ~6 feste Stil-Voreinstellungen als Buttons.
- **Prompt nicht überfrachten.** Ein knapper, positiver Prompt liefert bessere Ergebnisse
  als eine lange Verbotsliste. (Getestet: die einfache Variante war besser.)

## 4. Der funktionierende Prompt (Vorlage, hat real gut funktioniert)

```
Virtually stage this empty room as a warm, elegant living room for a high-end real
estate listing. This is a classic European old-building apartment.

KEEP EXACTLY AS IN THE ORIGINAL — do not alter: the herringbone oak parquet floor, the
white paneled walls and molding, the tall white windows with shutters and iron balcony
railing, the white paneled doors, the ceiling and proportions, the exact camera angle and
perspective, and the natural daylight from the windows.

ADD photorealistic, tasteful furniture: a linen sofa, two soft armchairs, a round oak
coffee table on a textured wool rug, a slim wooden sideboard, a floor lamp, framed art,
an olive tree.

STYLE: timeless, warm, understated luxury, neutral and earthy tones.

Match the existing lighting and shadows so the furniture sits naturally. Keep it fully
photorealistic and marketing-ready.
```

Stil-Block austauschen für Varianten:
- Skandinavisch: `STYLE: Scandinavian, light woods, white and beige textiles, minimal, airy, cozy.`
- Klassisch/Pariser: `STYLE: classic Parisian, velvet sofa, brass accents, deep warm tones, refined.`
- Modern minimal: `STYLE: modern minimalist, clean lines, muted greys, sculptural furniture, few objects.`

Gegen den "KI-Look" (nur falls nötig, nicht überdosieren): "a real photograph, not a 3D
render, shot on a 35mm lens" + "realistic contact shadows where furniture meets the floor".

Praxis-Tipp fürs Eingabebild: die Viewer-UI (Logo, Buttons) vor dem Senden wegschneiden,
nur das reine Raumbild schicken.

## 5. Modell + Kosten

- Modell: **"Nano Banana" = Google Gemini 2.5 Flash Image** (Gemini API).
- Preis: ca. **$0.039 / Bild** (Batch ~$0.0195). Eine 4-Raum-Wohnung in 3 Stilen ~ $0.47.
- **Immer serverseitig** aufrufen (API-Key nie im Browser). Ergebnisse speichern, nicht neu
  generieren.
- Docs: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
- Pricing: https://ai.google.dev/gemini-api/docs/pricing

## 6. Architektur (an den echten Repo-Stack gemappt)

Monorepo `apps/`: `viewer` (Frontend), `concierge-api` (Backend), `website` (Next.js).

**Frontend — `apps/viewer`** (PlayCanvas `@playcanvas/supersplat-viewer`, playcanvas 2.19.7):
- Frame-Abgriff + Kamera-Pose: siehe `src/camera-manager.ts` und `src/cameras/`.
- Pinning/Hotspots wiederverwenden: `src/annotations.ts` / `src/annotation.ts` (das
  Annotation-System ist die Basis für die "Möbliert ansehen"-Pins).
- Backend-Aufruf-Muster gibt es schon: `src/concierge.ts` (so ruft der Viewer das Backend).
- Button/Overlay-UI: `src/ui.ts`. Interaktions-Muster: `src/picker.ts`, `src/measure.ts`.
- Reihenfolge: Button "Möbliert sehen" -> Canvas-Frame rendern -> ans Backend -> Bild
  zurück -> Overlay mit Vorher/Nachher-Umschalter + Stil-Wähler.

**Backend — `apps/concierge-api`** (Cloudflare Worker; `wrangler.toml`, `src/worker.ts`,
`src/core.ts`, `src/prompt.ts`):
- Neuen Endpunkt nach dem Muster des Concierge bauen. Nimmt Bild + Stil entgegen, baut den
  Prompt aus einer Vorlage (`prompt.ts`-Stil), ruft Gemini Image, gibt/speichert das Bild.
- `GEMINI_API_KEY` als Worker-Secret (wrangler) hinterlegen. Prüfen, wie der Concierge heute
  seinen LLM aufruft (`core.ts`) und gleich vorgehen.
- Rate-Limit/CORS/Validation existieren schon: `src/ratelimit.ts`, `src/cors.ts`,
  `src/validation.ts` mitnutzen.

**Storage:** generierte Bilder pro Szene + Standpunkt ablegen (gleiche Ablage wie Touren).

## 7. Ehrliche Grenzen (respektieren, nicht dagegen ankämpfen)

- 2D-Standbild, kein begehbares 3D.
- Kamera-Drift: Nano Banana re-rendert das Bild neu, komponiert nicht pixelgenau. Für
  exaktes Pinnen in die Tour deshalb **Überblendung** nutzen, nicht harte Überlagerung. Für
  eigenständige Hero-Bilder egal.
- Keine Mehrwinkel-Konsistenz (siehe oben) -> ein Winkel pro Raum.

## 8. Geschäftlicher Rahmen (kurz)

Margenstarkes Add-on, NICHT der Kern. Kosten Cent, Verkaufspreis 30-80 EUR/Raum. Stärkster
Wert bei **leeren** Objekten (Neubau/Bauträger, Leerstand). Als Premium-Aufpreis oder Teil
des Premium-Hostings verkaufen. Nicht gratis dazugeben. Qualität hart prüfen, ein billiger
KI-Look schadet der Premium-Marke.

## 9. Erste Schritte für die neue Session

1. `AGENTS.md` lesen. Achtung: `apps/website` ist eine ungewöhnliche Next.js-Version, vor
   dem Coding die Docs in `apps/website/node_modules/next/dist/docs/` lesen.
2. `apps/viewer/src/concierge.ts`, `camera-manager.ts`, `annotations.ts`, `ui.ts` lesen, um
   Frame-Abgriff, Kamera-Pose, Pin-System und Backend-Aufruf zu verstehen.
3. `apps/concierge-api/src/core.ts` + `worker.ts` lesen, um den LLM-Aufruf-Stil zu kopieren.
4. MVP-Schritt 1 (Pipeline beweisen): On-demand "Möbliert sehen" -> Frame -> neuer
   Backend-Endpunkt -> Gemini Image -> Bild zurück -> Overlay mit Vorher/Nachher.
5. Danach: Pinning pro Standpunkt + Stil-Voreinstellungen + Speichern.

## 10. Marken-/Stil-Hinweise

- Marke: "Step Inside" = Ankommen, Schwelle, Premium, done-for-you.
- In nutzersichtbarer Copy: keine Gedankenstriche (em-dash), keine KI-Floskeln.

## 11. Quellen

- Real Horizons Feature (Vorbild): https://realhorizons.ai/features
- radiancefields zur "AI Reframe"-Umsetzung (nutzt Nano Banana):
  https://radiancefields.com/spatial-studio-adds-ai-authoring-layer
- Gemini 2.5 Flash Image Doku: https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image
- Gemini Pricing: https://ai.google.dev/gemini-api/docs/pricing
