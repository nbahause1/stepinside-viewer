# StepInside

Monorepo für StepInside (3D Gaussian Splatting).

## Struktur

```
apps/
  website/   Marketing-/Produkt-Website (Next.js)  → siehe apps/website/README.md
  viewer/    3DGS-Viewer / einbettbarer Player      (geplant)
```

Alles Website-spezifische (Code, Configs, Design-Docs, Assets) liegt unter
`apps/website`. Der Repo-Root enthält nur übergreifende Dinge (Agent-Instruktionen,
diese README, geteiltes `.gitignore`).

## Website lokal starten

```bash
cd apps/website
npm install   # nur beim ersten Mal
npm run dev
```

## Viewer

Der `apps/viewer` wird der eigene 3DGS-Viewer: gehostet bei StepInside, per
iFrame-Embed oder QR-Link auf Kundenseiten ausgeliefert, mit Navigation,
Vermessung und Hotspots. Noch nicht angelegt.
