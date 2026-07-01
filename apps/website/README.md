# StepInside Website

Marketing site for StepInside (stepinside.eu) — photorealistic, walkable 3D tours
(Gaussian splatting) for real estate, hotels, gastronomy and more. Next.js 16
app router, Tailwind v4, German-first copy (an English dictionary exists but is
currently deactivated).

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## The embedded viewer (`public/viewer/`)

The walkable demo in the "Demos" section is the built viewer app from
`apps/viewer`, bundled into this site so it ships on the same domain:

```bash
npm run sync:viewer
```

**Caveat:** this command **deletes and recreates `public/viewer/` entirely**
(it rebuilds `apps/viewer` and copies its output over). Never place hand-edited
files inside `public/viewer/` — they will be wiped on the next sync.

## Configuration

Runtime values (contact details, Formspree ID, viewer URL, legal data) live in
`lib/config.ts`. UI copy lives in `components/i18n/dictionary.ts`.
