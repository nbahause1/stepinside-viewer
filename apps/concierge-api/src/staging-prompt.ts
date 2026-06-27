/**
 * Virtual-staging prompt construction ("AI Reframe").
 *
 * The model gets a flat 2D render of an EMPTY room and returns a flat 2D image
 * of the SAME room, furnished. It never sees the 3D splat. A short, positive
 * prompt beats a long ban-list (tested), so we keep it tight: one fixed base
 * that locks the architecture + camera, plus one swappable STYLE line.
 *
 * The base is tuned for the example scene (a classic European old-building /
 * Altbau apartment). Per-scene overrides can be threaded through later; for the
 * MVP this single template proves the pipeline.
 */

/** A selectable furnishing style: the swappable STYLE block. */
export interface StagingStyle {
  id: string;
  /** Human label (German, shown in the viewer UI). */
  label: string;
  /** The STYLE line injected into the prompt. */
  style: string;
}

/**
 * Curated styles. `id` is what the browser sends; the server is the sole source
 * of the actual prompt text (the client can never inject prompt content).
 */
export const STAGING_STYLES: StagingStyle[] = [
  {
    id: 'warm',
    label: 'Warm & elegant',
    style: 'warm, timeless, understated luxury — neutral and earthy tones, natural materials (oak, linen, wool), soft layered textures.'
  },
  {
    id: 'scandi',
    label: 'Skandinavisch',
    style: 'Scandinavian — light woods, white and beige textiles, clean simple forms, airy and cosy, a couple of green plants.'
  },
  {
    id: 'classic',
    label: 'Klassisch',
    style: 'classic Parisian elegance — a velvet sofa, brass accents, deep warm tones, refined timeless pieces.'
  },
  {
    id: 'modern',
    label: 'Modern',
    style: 'modern minimalist — clean lines, muted greys, a few sculptural pieces, calm and uncluttered.'
  }
];

/** The default style id used when the client omits one or sends an unknown id. */
export const DEFAULT_STYLE_ID = 'warm';

/** Look up a style by id, falling back to the default. */
export function resolveStyle(id: string | undefined): StagingStyle {
  return STAGING_STYLES.find(s => s.id === id) ??
    STAGING_STYLES.find(s => s.id === DEFAULT_STYLE_ID)!;
}

/**
 * Build the full text prompt for a given style. Mirrors the proven template from
 * the feature brief: lock everything structural + the camera, ADD tasteful
 * furniture, swap only the STYLE line.
 */
/**
 * Build the staging prompt. SCAN-AGNOSTIC by design: instead of hard-coding this
 * room's geometry, it tells the model to read the room from the photo itself
 * (find the windows, doors and the largest blank wall) and anchor furniture to
 * the walls. This is what stops the model clustering everything in the centre,
 * and it generalises across scans (validated on two different rooms/angles).
 *
 * `roomType` lets a scene declare what the space is (defaults to a living room);
 * `spatialHint` is an optional per-scene sentence to sharpen a specific scan
 * (e.g. "the only blank wall is on the right"). Both are optional — the generic
 * prompt already works without them.
 */
export function buildStagingPrompt(
  style: StagingStyle,
  roomType: string = 'living room',
  spatialHint?: string,
): string {
  const hint = spatialHint ? `\nScene note: ${spatialHint}\n` : '';
  return `You are a professional real-estate home stager. The provided photograph is an EMPTY room, shot from a high angle looking down so most of the floor is visible. FIRST read the room from the photo itself: identify where the windows are, where the doors are, and which wall is the largest uninterrupted (blank) wall.${hint}

Then furnish it as a ${roomType} exactly as a real person would actually do it:
- ANCHOR the furniture to the walls. Place the largest piece (e.g. the sofa) FLAT AGAINST THE LARGEST UNINTERRUPTED WALL — a wall without doors or windows — oriented to face the windows and the daylight; never floating in the middle of the room.
- Keep the CENTRE of the floor OPEN. Do NOT pile the furniture into the middle of the room.
- Create one coherent ${roomType} zone: the wall-anchored main piece, a coffee table on a rug sized to the seating, and one or two armchairs angled toward it. Add a low sideboard flat against another free wall, a floor lamp and a tall plant in corners, and framed art on a wall.
- Leave clear access to every door and keep the windows fully unobstructed.
- Scale the furniture to the room and its ceiling height; use only a few well-chosen pieces with generous open floor around them.

PRESERVE the photograph exactly except for the furniture you add: identical floor, walls, mouldings and panelling, windows, doors, ceiling, the exact camera angle and perspective, the same daylight, resolution and sharpness. Do not re-render, repaint or restyle the room itself.

STYLE: ${style.style}

A photorealistic, wide-angle interior real-estate photograph with correct perspective aligned to the room's vanishing lines, realistic scale and soft, accurate contact shadows where furniture meets the floor. Not a 3D render, not CGI, no text, no watermark.`;
}
