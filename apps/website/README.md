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

**Caveat:** this command rebuilds `apps/viewer` and copies **only the build
artifacts** (`index.html`, `index.js`, `index.css` and, if present,
`settings.json`) over the existing files in `public/viewer/`. Everything else
in that directory — most importantly the scene assets (`scene.sog` etc.),
which exist nowhere else — is left untouched. Still, never hand-edit the four
artifact files themselves; they will be overwritten on the next sync.

## Configuration

Runtime values (contact details, Formspree ID, viewer URL, legal data) live in
`lib/config.ts`. UI copy lives in `components/i18n/dictionary.ts`.
