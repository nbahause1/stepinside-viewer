# Design

Visual system for StepInside. It follows the "Pravah" reference: a warm,
near-monochromatic engineering-dossier aesthetic. Light theme only, with a single
dark inversion band. Depth comes from tonal surface shifts and 1px borders, never
shadows or gradients. The committed brand colours below are authoritative; preserve
them rather than re-deriving a palette.

## Theme

- Mode: **light only** (no dark-mode toggle, no `dark:` variants). `color-scheme: light`.
- Temperature: warm-neutral. No chromatic accent colour anywhere.
- Two dark surfaces on the home page: the full-bleed video hero (white text over a flat ink scrim) and the Process band. Everything between and after stays light.
- Feel: measured, scientific, quietly confident; printed/flat, not digital-glossy.

## Color

Tokens are defined in `app/globals.css` under `@theme` as Tailwind utilities
(`bg-parchment`, `text-ink`, `border-bone`, ...).

| Token | Hex | Role |
|---|---|---|
| `parchment` | `#f3f1ed` | Page canvas (warm off-white) |
| `pure-white` | `#ffffff` | Card surfaces, badge fills, inputs |
| `ink` | `#181011` | Primary text, borders, structural strokes |
| `charcoal` | `#222222` | Secondary text / body |
| `aubergine` | `#302023` | The single dark inversion band background |
| `ash` | `#aaaaaa` | Muted text on dark; never small interactive text on light |
| `dim` | `#666666` | Captions, placeholders, tertiary metadata on light (AA-safe) |
| `bone` | `#d8d4d4` | Hairline borders, low-emphasis dividers |

Rules: no gradients, no chromatic accents, no shadows. Contrast accents are achieved
by tonal inversion (parchment <-> aubergine), not colour. Placeholders and small
interactive text on light surfaces use `dim`, not `ash` (AA contrast).

## Typography

- Single family: **Inter** (loaded via `next/font`, variable `--font-inter`).
  Substitute for the reference's ABCfavorit. No second family ever.
- Weights: **400** (body and most text) and **700** (emphasis lines, navigation,
  short headings). Hierarchy is size + weight, never colour.
- Scale (px): caption 12, small 14, body 15-17, subheading 20, heading-sm 28,
  heading 32, heading-lg 40, display 48.
- Letter-spacing: `-0.02em` on text >= 28px; `0.10em` (uppercase) on field-tag labels.
- Line height: ~1.1 display, ~1.3 headings, ~1.5 body.
- Cap prose line length around 60-68ch.

## Spacing & Shape

- Base unit 8px. Section vertical rhythm `py-20 md:py-28` (64-80px+).
- Container: `mx-auto max-w-[1200px] px-6`.
- Radius: **4px** for cards, inputs, badges; **100px** (pill) only for primary CTAs.
  Nothing else gets rounded above 4px.
- No shadows at any elevation. Separation is border (`bone`) plus surface tone.

## Components

- **PillButton** (`components/ui/PillButton.tsx`): outlined ghost button, no fill,
  no shadow. `variant="pill"` (100px) for primary CTAs, `variant="square"` (4px) for
  secondary. `tone="ink"` on light, `tone="white"` on the dark band. Subtle hover
  tint + `active:translate-y-px`; built-in focus-visible ring. Note: a `hidden`
  utility passed via `className` is overridden by its base `inline-flex`; gate
  visibility with a wrapper element instead.
- **SectionLabel** (`components/ui/SectionLabel.tsx`): uppercase 12px tracked field
  tag. `tone="light"` (white fill on parchment) / `tone="dark"` (outlined on aubergine).
- **DiamondGrid** (`components/ui/DiamondGrid.tsx`): n x n rotated squares, uses
  `currentColor`; decorative (`aria-hidden`). The Pravah list/marker motif.
- **RoomWireframe** (`components/illustrations/RoomWireframe.tsx`): 1px isometric
  line schematic, `currentColor`, no fills. Pass `decorative` to hide it from
  assistive tech. This is the brand's substitute for photography.
- **Reveal** (`components/ui/Reveal.tsx`): subtle scroll fade+rise via `motion`,
  reduced-motion safe. The only motion primitive; reuse it.
- **Glass notification card** (in Hero): `bg-pure-white/90 backdrop-blur-sm` + 1px
  bone border, no shadow. Used sparingly over the wireframe.

## Motion

Energy is low and purposeful. Entrance reveals only, via `Reveal` (fade + small
rise, ease-out). No infinite loops, no parallax, no scroll-hijacking, no scroll
listeners. Every animation honors `prefers-reduced-motion` (collapses to static).

## Layout

1200px max content width. The home page is five sections: (1) Hero - full-bleed
muted video with overlaid text; (2) Audience - a light card grid (white-on-parchment
cards) answering "who it's for"; (3) Demos - full-width stacked media (one scan per
item); (4) Process - the single full-bleed aubergine band with a marked step list;
(5) Contact - form + direct-details split. About lives on its own route `/ueber-uns`
(quiet prose), not in the home scroll. Sections alternate parchment with the one dark
Process band. Non-sticky top nav with a single bottom hairline and NO in-page section
anchors (only the About route, language, contact CTA). Mobile-first: everything
collapses to a single column with `px-6`.

## Imagery

No stock photos, no lifestyle imagery, no AI imagery. The home hero is a muted,
looping background video (`public/hero.mp4`, web-compressed to ~7.6MB at 1152px,
with `public/hero-poster.jpg` painting instantly) under a flat ink scrim with
white text over it. Real, walkable 3D scans (SuperSplat / iframe embeds) remain
the focal point further down; empty slots show a quiet wireframe placeholder.
Other supporting visuals are 1px line schematics and the diamond-grid motif only.
