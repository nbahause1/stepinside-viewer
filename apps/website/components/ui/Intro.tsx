"use client";

import { useEffect, useState } from "react";

/*
  First-load intro: a dark screen showing only the square mark, centred. The
  mark fades in, spins into the diamond, then the "StepInside" wordmark unfurls
  to its RIGHT via a clip that opens outward. Once the "◆ StepInside" lockup is
  assembled it does NOT simply fade: it GLIDES up to the hero logo's resting
  spot (top-centre) and shrinks to the hero logo's exact size while the midnight
  backdrop fades to expose the hero video — a seamless shared-element handoff to
  the static hero logo (which is hidden, via .intro-playing, until we land).

  The resting position/size is measured at runtime from [data-brandmark] so the
  glide lands pixel-accurately on the hero logo at any viewport size.

  Plays on every (re)load; skipped under prefers-reduced-motion. The width reveal
  is an inline grid 0fr→1fr (robust against the Tailwind v4 keyframe shaking).
*/
export default function Intro() {
  // Rendered in the initial HTML so it covers from the first paint.
  const [show, setShow] = useState(true);
  const [marked, setMarked] = useState(false); // square fades in
  const [spun, setSpun] = useState(false); // square spins into the diamond
  const [revealed, setRevealed] = useState(false); // wordmark unfurls to the right
  const [leaving, setLeaving] = useState(false); // lockup glides into hero spot
  // Offset (px) from viewport centre to the hero logo's centre — the glide target.
  const [offset, setOffset] = useState<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setShow(false);
      return;
    }

    // The intro is a from-the-top experience: the lockup glides onto the hero
    // logo's resting spot and the video sits behind it. Opt out of the browser's
    // automatic scroll restoration — on reload it would otherwise drop the
    // visitor back at their previous position (e.g. the viewer section) while
    // the intro plays from the top, so they'd "land" in the wrong place. Pin to
    // the top so the handoff always lands correctly.
    history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    document.documentElement.classList.add("intro-playing");
    document.body.style.overflow = "hidden";

    // Measure the hero logo's resting centre so the glide lands exactly on it.
    const measure = () => {
      const el = document.querySelector<HTMLElement>("[data-brandmark]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      setOffset({
        dx: r.left + r.width / 2 - window.innerWidth / 2,
        dy: r.top + r.height / 2 - window.innerHeight / 2,
      });
    };
    measure();

    const raf = requestAnimationFrame(() => {
      setMarked(true);
      setSpun(true);
    });
    // Begin the wordmark reveal while the square is still visibly spinning so
    // the two motions overlap and blend, with no perceptible pause between them.
    const tReveal = setTimeout(() => setRevealed(true), 450);
    const tLeave = setTimeout(() => setLeaving(true), 1350);
    // Once the glide has landed (~2190ms), reveal the static hero logo while it
    // is still fully covered by the identical, opaque lockup — its 150ms
    // opacity transition fades in invisibly behind the overlay...
    const tHandoff = setTimeout(() => {
      document.documentElement.classList.remove("intro-playing");
    }, 2240);
    // ...then drop the overlay only after the hero logo is fully opaque, so the
    // swap is seamless (no flash of the logo disappearing).
    const tDone = setTimeout(() => {
      setShow(false);
      document.body.style.overflow = "";
    }, 2480);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(tReveal);
      clearTimeout(tLeave);
      clearTimeout(tHandoff);
      clearTimeout(tDone);
      document.documentElement.classList.remove("intro-playing");
      document.body.style.overflow = "";
    };
  }, []);

  if (!show) return null;

  // Final resting transform: glide to the measured hero spot at scale 1. Falls
  // back to a sensible top-centre estimate if the measurement didn't land.
  const restTransform = offset
    ? `translate(${offset.dx}px, ${offset.dy}px) scale(1)`
    : "translateY(calc(30px - 50vh)) scale(1)";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
    >
      {/* Midnight backdrop — fades away to reveal the hero video underneath. */}
      <div
        className={`absolute inset-0 bg-midnight transition-opacity duration-[700ms] ease-out ${
          leaving ? "opacity-0" : "opacity-100"
        }`}
      />

      {/* Lockup wrapper: holds the build-up centred and large (scale 1.5), then
          on leave glides to the hero logo's spot and shrinks to scale 1 (= hero
          size) for a pixel-accurate handoff. */}
      <div
        className="relative"
        style={{
          transform: leaving ? restTransform : "translateY(0) scale(1.5)",
          transition: "transform 840ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          className={`flex items-center text-paper transition-opacity duration-[330ms] ease-out ${
            marked ? "opacity-100" : "opacity-0"
          }`}
        >
          {/* The square mark — fades in, then spins 405° into the diamond with a
              fast-start / smooth-settle curve. size-2 matches the hero diamond. */}
          <span
            className="block size-2 shrink-0 bg-paper"
            style={{
              transform: spun ? "rotate(405deg)" : "rotate(0deg)",
              transition: "transform 950ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />

          {/* Wordmark, revealed only by the clip opening rightward from the mark.
              Styled to match the hero logo (16px bold) so the handoff is exact. */}
          <span
            className="grid"
            style={{
              gridTemplateColumns: revealed ? "1fr" : "0fr",
              transition:
                "grid-template-columns 730ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <span className="overflow-hidden">
              <span className="block whitespace-nowrap pl-2.5 text-[16px] font-bold tracking-[0.01em]">
                StepInside
              </span>
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
