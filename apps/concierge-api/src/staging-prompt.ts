/**
 * Virtual-staging prompt construction ("AI Reframe") with reference-image
 * conditioning.
 *
 * The model gets image 1 = the room to furnish (the captured EMPTY scan frame)
 * plus images 2..N = real designer-furniture reference photos for the chosen
 * style. It returns the SAME room, furnished with pieces that match the
 * references. Feeding real Vitra/USM cutouts is what lifts the result from
 * generic "AI furniture" to designer-grade staging (validated end-to-end).
 *
 * The architecture-lock block is critical for the scan<->furnished toggle: the
 * furnished image must keep the room's windows/doors/walls pixel-identical to
 * the scan it overlays, so switching looks like ONLY furniture appears.
 *
 * `id` is all the browser sends; the server owns the prompt text and the
 * reference set, so a client can never inject prompt content.
 */

/** A selectable furnishing style. */
export interface StagingStyle {
  id: string;
  /** Human label (German, shown in the viewer UI). */
  label: string;
  /** Folder under `staging-refs/` holding this style's reference photos. */
  dir: string;
  /** Reference photo filenames, in the order the prompt refers to them (image 2..N). */
  refs: string[];
  /** The placement instructions; assumes image 1 = room, images 2..N = refs in `refs` order. */
  placement: string;
}

/**
 * Holistic home-staging methodology, prepended before the per-piece placement.
 * Reference cutouts fix WHICH furniture and its quality; the model still has to
 * decide HOW the room is composed, and left to itself it scatters pieces or
 * clusters them in the centre. This block gives it the rules a real stager uses
 * so the arrangement reads logical and intentional, not random.
 */
const METHODOLOGY = `Arrange the room like a professional home stager, not by scattering pieces around:
- Anchor everything to the walls and corners. Nothing floats in the middle of the room; keep the centre of the floor open so the space reads large and the floor (such as the parquet) stays on show.
- Build ONE clear seating group, oriented to the room's strongest architectural feature (the windows and the daylight, or a fireplace or feature wall if there is one). The sofa stands flat against the longest unbroken wall, facing that focal point.
- Lay a rug under the seating group to tie it together: the front legs of the sofa and chairs rest on the rug, the coffee table centred on it.
- Keep clear walkways of roughly 80cm along the natural path through the room and in front of every door. No piece blocks a window or a doorway.
- Scale the furniture honestly to the room and its ceiling height; do not shrink the pieces or cram them in. When in doubt, UNDER-furnish: a few well-placed pieces look more expensive than a crowded room.
- Give every piece a logical reason for where it sits (sideboard flat on a free wall, floor lamp in a corner beside the seating and switched on with a soft warm glow, side chairs angled into the group).`;

/** Shared rule block appended to every style prompt. */
const PRESERVE = `Keep the centre of the floor open and leave every door and window clear. Use only these few pieces; do not invent extra furniture. Ignore any logos, text or watermarks printed on the reference photos.

CRITICAL - FREEZE THE ARCHITECTURE: treat the room shell as a locked background plate. Do NOT move, resize, add, remove or redraw any window, door, wall, moulding, panel, skirting or the ceiling. Every window and door must keep its EXACT position, width, height and perspective from image 1, pixel-for-pixel. Keep the identical floor, the exact same camera angle, vanishing lines and daylight. The ONLY change allowed is placing the furniture on the floor, so the result lines up perfectly with the original empty room.

Photorealistic interior real-estate photograph, realistic scale and soft accurate contact shadows where furniture meets the floor. Not a 3D render, no CGI, no text, no watermark.`;

/**
 * Curated styles. The ids (classic / scandi / warm) match what the viewer's
 * settings.json sends; each maps to a reference set + placement prompt.
 */
export const STAGING_STYLES: StagingStyle[] = [
  {
    id: 'classic',
    label: 'Designklassiker',
    dir: 'set1-vitra-klassiker',
    refs: ['anagram-sofa.jpg', 'eames-lounge-chair.jpg', 'noguchi-coffee-table.jpg', 'vitra-akari-lamp.png'],
    placement: `Furnish the empty room (image 1) with these exact designer pieces; in images 2-5 use ONLY the furniture item itself and ignore its background. Reproduce each faithfully (exact shape, proportions and materials):
- Image 2: a Vitra "Anagram" sofa by Panter&Tourron - low rounded arms, a slim lacquered base frame with short curved legs, soft boxy cushions, warm terracotta/rust fabric. Place it flat against the largest blank wall, facing the windows.
- Image 3: a Vitra Eames Lounge Chair with Ottoman - black leather buttoned cushions, curved walnut plywood shell, polished aluminium five-star swivel base. Angle it toward the seating.
- Image 4: a Vitra Noguchi coffee table - two identical solid walnut pieces interlocking to form the base, under a thick tear-drop glass top. Put it in front of the sofa on a simple plain low-pile rug.
- Image 5: an Akari floor lamp by Isamu Noguchi - a tall, slim, irregularly folded washi-paper shade on thin black wire tripod legs, glowing warm. Stand it in a corner near the seating.`,
  },
  {
    id: 'scandi',
    label: 'Minimal',
    dir: 'set2-usm-vitra-minimal',
    refs: ['usm-haller-sideboard.jpg', 'soft-modular-sofa.jpg', 'eames-dsw-chair.jpg'],
    placement: `Furnish the empty room (image 1) in a clean, minimalist Swiss-design style with these exact pieces; in images 2-4 use ONLY the furniture item itself and ignore its background. Reproduce each faithfully (exact shape, proportions and materials):
- Image 2: a USM Haller modular sideboard in pure white (RAL 9010) - a chrome tubular frame with flat white metal panels, two drop-down doors with the signature round chrome ball handles and chrome ball joints at every corner, low on small chrome feet. Place it flat against a free wall.
- Image 3: a Vitra "Soft Modular" sofa by Jasper Morrison - a low, ground-hugging sofa with thick boxy cushions, soft square arms and a recessed dark plinth base, in a cream/ivory fabric. Place it against the largest blank wall, facing the windows.
- Image 4: two Vitra Eames Plastic Side Chairs (DSW, NO armrests) - a light grey moulded seat shell on slim yellowish-maple dowel legs with a black wire strut. Place them as a small pair near the seating.
Add a simple low rectangular coffee table in light oak in front of the sofa on a plain pale rug, and a green plant in a corner.`,
  },
  {
    id: 'warm',
    label: 'Colour-Pop',
    dir: 'set3-colour-pop',
    refs: ['usm-haller-sideboard.jpg', 'panton-chair.jpg', 'eames-dsw-chair.jpg', 'soft-modular-sofa.jpg'],
    placement: `Furnish the empty room (image 1) in a confident, characterful colour-pop style with one or two bold accents against the calm room; in images 2-5 use ONLY the furniture item itself and ignore its background. Reproduce each faithfully (exact shape, proportions and materials):
- Image 2: a USM Haller modular sideboard - chrome tubular frame, flat metal panels with the signature round chrome ball handles and ball joints - rendered in a bold GOLDEN YELLOW. Place it flat against a free wall as the statement piece.
- Image 3: a Vitra Panton Chair - a single flowing S-shaped cantilever chair moulded in one piece, glossy, in classic RED. Place it as an accent near the window.
- Image 4: a couple of Vitra Eames Plastic Side Chairs (DSW) with maple dowel legs, seat shells in soft muted colours. Place them near the seating.
- Image 5: a Vitra "Soft Modular" sofa by Jasper Morrison - low, boxy, soft square arms, recessed dark plinth base - in a warm neutral oatmeal fabric so the colour accents stand out. Place it against the largest blank wall, facing the windows.
Add a simple low coffee table and a plain rug.`,
  },
];

/** The default style id used when the client omits one or sends an unknown id. */
export const DEFAULT_STYLE_ID = 'classic';

/** Look up a style by id, falling back to the default. */
export function resolveStyle(id: string | undefined): StagingStyle {
  return STAGING_STYLES.find(s => s.id === id) ??
    STAGING_STYLES.find(s => s.id === DEFAULT_STYLE_ID)!;
}

/**
 * Build the full text prompt for a style. Image 1 is the room to furnish (the
 * captured scan frame); images 2..N are the style's reference pieces.
 */
export function buildStagingPrompt(style: StagingStyle): string {
  return `You are a professional real-estate home stager. Image 1 is the room to furnish, shot from a high angle. If it already contains any furniture, remove it first.

${METHODOLOGY}

${style.placement}

${PRESERVE}`;
}
