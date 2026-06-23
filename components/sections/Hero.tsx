"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Hero (Aker): a full-bleed muted background video opens the page like a darkroom
  gallery wall. A single flat ink scrim keeps the white text legible (no gradient,
  no shadow). The monumental whisper-weight headline anchors the bottom-left in
  wordmark style, with a quiet grey value line and one ghost "Demo anfordern" CTA
  that jumps to the scan / request section. The walkable scans live further down.
*/
export default function Hero() {
  const { t } = useLang();

  return (
    <section
      id={SECTION_IDS.top}
      className="relative isolate flex min-h-[100svh] overflow-hidden bg-midnight"
    >
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/hero-poster.jpg"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {/* Flat ink scrim for text legibility (no gradient, no shadow). */}
      <div aria-hidden="true" className="absolute inset-0 bg-ink/55" />

      {/* Full-width frosted dome: a downward-opening half-circle whose arc
          starts at both top corners and bulges deepest in the centre. The
          horizontal radius is exactly half the width (so the arc meets the
          corners); it fades to transparent along the arc. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-[14vw] max-h-[170px]">
        <div
          aria-hidden
          className="absolute inset-0 backdrop-blur-2xl [mask-image:radial-gradient(50%_100%_at_50%_0%,#000_60%,transparent_100%)] [-webkit-mask-image:radial-gradient(50%_100%_at_50%_0%,#000_60%,transparent_100%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(50%_100%_at_50%_0%,rgba(255,255,255,0.16),transparent_72%)]"
        />
        <div className="absolute inset-x-0 top-0 flex justify-center pt-5">
          {/* Very subtle living glow: a soft white halo breathes in and out with
              a barely-there scale pulse. Raw <style> so the Tailwind v4 build
              keeps the keyframes; reduced-motion stills it via the global rule. */}
          <style>{`
            @keyframes logoGlow {
              0%, 100% {
                filter: drop-shadow(0 0 1px rgba(255,255,255,0.15));
                transform: scale(1);
              }
              50% {
                filter: drop-shadow(0 0 6px rgba(255,255,255,0.85)) drop-shadow(0 0 2px rgba(255,255,255,0.6));
                transform: scale(1.025);
              }
            }
          `}</style>
          <a
            href={"#" + SECTION_IDS.top}
            aria-label="StepInside"
            data-brandmark
            style={{
              // Delayed so the first glow peak (at 50% of the cycle = 1.8s)
              // lands at ~2.55s — exactly when the intro hands the logo off at
              // its final position, so it flashes on arrival.
              animation: "logoGlow 3.6s ease-in-out 0.75s infinite",
            }}
            className="pointer-events-auto inline-flex items-center gap-2.5 text-paper transition-opacity hover:opacity-70"
          >
            <span aria-hidden className="block size-2 rotate-45 bg-paper" />
            <span className="text-[16px] font-bold tracking-[0.01em]">
              StepInside
            </span>
          </a>
        </div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col justify-end px-6 py-24 md:py-28">
        <Reveal delay={0.1}>
          <h1 className="max-w-[16ch] text-[clamp(2.75rem,8vw,7rem)] font-light leading-[0.92] tracking-[-0.025em] text-paper">
            {t.hero.headline}
          </h1>

          <p className="mt-6 max-w-[42ch] text-[15px] leading-[1.5] text-paper/70 md:text-[17px]">
            {t.hero.sub}
          </p>

          <div className="mt-8">
            <PillButton
              variant="ghost"
              tone="paper"
              href={"#" + SECTION_IDS.demos}
            >
              {t.hero.ctaPrimary}
            </PillButton>
          </div>
        </Reveal>
      </div>

      {/* Scroll hint: a softly bobbing chevron nudging the visitor downward.
          Keyframes live in a raw <style> tag (not Tailwind/Lightning-processed,
          so they survive the build); the global prefers-reduced-motion block
          still disables them via !important. */}
      <style>{`
        @keyframes scrollHintBob {
          0%, 100% { transform: translateY(0); opacity: 0.65; }
          50% { transform: translateY(7px); opacity: 1; }
        }
      `}</style>
      <a
        href={"#" + SECTION_IDS.audience}
        aria-label={t.hero.scrollHint}
        onClick={(e) => {
          // Land flush at the section's top edge (no hero video sliver above);
          // bypasses the global [id]{scroll-margin-top:32px} offset.
          const el = document.getElementById(SECTION_IDS.audience);
          if (el) {
            e.preventDefault();
            window.scrollTo({
              top: el.getBoundingClientRect().top + window.scrollY,
              behavior: "smooth",
            });
            history.replaceState(null, "", "#" + SECTION_IDS.audience);
          }
        }}
        className="absolute inset-x-0 bottom-6 z-10 mx-auto flex w-max items-center justify-center rounded-full p-2 text-paper/70 transition-colors hover:text-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/50"
      >
        <CaretDown
          size={28}
          weight="thin"
          aria-hidden
          style={{ animation: "scrollHintBob 1.9s ease-in-out infinite" }}
        />
      </a>
    </section>
  );
}
