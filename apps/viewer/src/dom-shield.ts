/**
 * Shield an overlay element (survey card, concierge panel, staging overlay…)
 * from the viewer underneath it. Interactions inside the overlay must not
 * reach the canvas/camera, and — for overlays with text inputs — typed keys
 * must not trigger the viewer's global hotkeys (1/2/3, r, space…).
 *
 * This consolidates a pattern that was hand-rolled in several modules with
 * DIFFERING completeness (the survey shielded keys, the concierge input did
 * not), which is exactly the class of "typing leaks to the viewer / focus is
 * stolen" bug this centralises away.
 *
 * The `click` case is subtle: the #ui container has a global click handler
 * that blurs document.activeElement after every click ("free the keyboard for
 * hotkeys"). Inside a form that instantly steals focus from the field being
 * typed into. So we stop the click here and, for buttons only, blur them
 * ourselves (so viewer hotkeys never stick to a pressed button) — never for
 * inputs.
 */
interface ShieldOptions {
  /** Overlay contains text inputs → also stop key events and guard focus. */
  hasInput?: boolean;
}

export function shieldFromViewer(el: HTMLElement, opts: ShieldOptions = {}): void {
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('wheel', e => e.stopPropagation());

  if (opts.hasInput) {
    el.addEventListener('keydown', e => e.stopPropagation());
    el.addEventListener('keyup', e => e.stopPropagation());
    el.addEventListener('keypress', e => e.stopPropagation());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target instanceof HTMLButtonElement) e.target.blur();
    });
  }
}
