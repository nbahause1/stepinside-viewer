"use client";

import { useEffect, useRef } from "react";

interface ScanFieldProps {
  className?: string;
}

/* Grid spacing (px) and how far the cursor's influence reaches. */
const SPACING = 22;
const RADIUS = 140;
/* Resting dot diameter (px) and how much it grows toward the cursor. */
const DOT_SIZE = 3;
const MAX_SCALE = 3.4;
const BASE_OPACITY = 0.16;
const MAX_OPACITY = 0.9;

/* Passive ambient "wave": two crossing sine waves drift across the grid so the
   field ripples even when nobody is hovering. The crests drive size AND
   brightness (like the hover pop), so the dots lift toward the viewer in 3D as
   the wave passes; the cursor's magnetic pop still blends a notch above. */
const WAVE_SCALE_AMP = 0.6; // extra scale at a crest: REST(0.29) -> ~0.89 of 1.0
const WAVE_OPACITY_AMP = 0.5; // extra opacity at a crest: BASE(0.16) -> ~0.66

/*
  Each dot is rendered at its largest size (DOT_SIZE * MAX_SCALE) and scaled DOWN
  at rest, so the cursor only ever scales it up to 1x — the bitmap is never
  magnified past its native resolution, which keeps the dots crisp instead of
  pixelating when they grow.
*/
const RENDER_SIZE = DOT_SIZE * MAX_SCALE;
const REST_SCALE = DOT_SIZE / RENDER_SIZE;

type Dot = { el: HTMLSpanElement; x: number; y: number };

/*
  Interactive "scan field": a faint monochrome dot grid (point-cloud nod) meant
  to sit as a full-bleed backdrop behind the scan-request box. A subtle ambient
  wave ripples across it at all times; the dots near the cursor scale up and
  brighten on top of that, lifting toward the viewer — a soft magnetic depth
  effect that responds anywhere over the field, including over the box on top of
  it. Decorative (aria-hidden). Under prefers-reduced-motion the grid is static.
*/
export default function ScanField({ className = "" }: ScanFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let dots: Dot[] = [];
    let raf = 0;
    // Target cursor position in host coords; -Infinity means "no cursor".
    let mx = -Infinity;
    let my = -Infinity;

    function build() {
      if (!host) return;
      host.replaceChildren();
      dots = [];
      const { width, height } = host.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      // Oversize the grid by one column/row and centre it, so the outermost
      // dots bleed just past every edge (clipped by the host's overflow-hidden).
      // This fills the field edge to edge with no inner margin; the bleeding
      // dots read as a half row/column at the rim.
      const cols = Math.max(1, Math.ceil(width / SPACING) + 1);
      const rows = Math.max(1, Math.ceil(height / SPACING) + 1);
      const offX = (width - cols * SPACING) / 2;
      const offY = (height - rows * SPACING) / 2;

      const frag = document.createDocumentFragment();
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = offX + c * SPACING;
          const y = offY + r * SPACING;
          const el = document.createElement("span");
          el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${RENDER_SIZE}px;height:${RENDER_SIZE}px;border-radius:50%;background:currentColor;opacity:${BASE_OPACITY};transform:translate(-50%,-50%) scale(${REST_SCALE});will-change:transform,opacity;`;
          frag.appendChild(el);
          dots.push({ el, x, y });
        }
      }
      host.appendChild(frag);
    }

    function frame(ts: number) {
      const r2 = RADIUS * RADIUS;
      for (const d of dots) {
        // Passive ambient wave: two long sines drifting in *similar* diagonal
        // directions (~24° apart) so they merge into smooth flowing bands
        // instead of a crossed checkerboard. Sum (-2..2) -> 0..1 "energy".
        const w =
          Math.sin(d.x * 0.011 + d.y * 0.0066 - ts * 0.002) +
          Math.sin(d.x * 0.0063 + d.y * 0.009 - ts * 0.0014);
        const wn = (w + 2) * 0.25;
        let scale = REST_SCALE + wn * WAVE_SCALE_AMP;
        let opacity = BASE_OPACITY + wn * WAVE_OPACITY_AMP;

        // Cursor magnetism blends on top of the wave: at the centre the dot
        // reaches full size / brightness; it eases to the wave value at RADIUS.
        const dx = d.x - mx;
        const dy = d.y - my;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < r2) {
          const k = 1 - Math.sqrt(dist2) / RADIUS;
          const e = k * k;
          scale += e * (1 - scale);
          opacity += e * (MAX_OPACITY - opacity);
        }

        d.el.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(3)})`;
        d.el.style.opacity = opacity.toFixed(3);
      }
      raf = requestAnimationFrame(frame);
    }

    function onMove(ev: PointerEvent) {
      if (!host) return;
      const rect = host.getBoundingClientRect();
      mx = ev.clientX - rect.left;
      my = ev.clientY - rect.top;
    }
    function onLeave() {
      mx = -Infinity;
      my = -Infinity;
    }

    build();

    const ro = new ResizeObserver(build);
    ro.observe(host);

    if (!reduce) {
      // Track on the window so dots react even while the cursor is over the
      // box layered on top of the field.
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerleave", onLeave);
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden text-ink ${className}`}
    />
  );
}
