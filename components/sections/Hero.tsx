"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Hero (Aker): a full-bleed muted background video opens the page like a darkroom
  gallery wall. A single flat ink scrim keeps the white text legible (no gradient,
  no shadow). Content is arranged in a column — a small intro sits top-left, and
  the monumental whisper-weight headline anchors the bottom-left, wordmark style.
  The video is a silent, looping ambient backdrop; a poster paints instantly while
  it loads. The walkable scans remain the star further down the page.
*/
export default function Hero() {
  const { t } = useLang();

  return (
    <section
      id={SECTION_IDS.top}
      className="relative isolate flex min-h-[88svh] overflow-hidden bg-midnight"
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
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col justify-between px-6 py-24 md:py-28">
        {/* Top: small overline + intro paragraph. */}
        <Reveal delay={0}>
          <div className="max-w-[44ch]">
            <SectionLabel tone="dark">{t.hero.label}</SectionLabel>
            <p className="mt-4 text-[15px] leading-[1.5] text-paper/85 md:text-[17px]">
              {t.hero.sub}
            </p>
          </div>
        </Reveal>

        {/* Bottom: monumental whisper-weight headline + ghost CTAs. */}
        <Reveal delay={0.1}>
          <div className="mt-16">
            <h1 className="max-w-[16ch] text-[clamp(2.75rem,8vw,7rem)] font-light leading-[0.92] tracking-[-0.025em] text-paper">
              {t.hero.headline}
            </h1>

            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
              <PillButton
                variant="ghost"
                tone="paper"
                href={"#" + SECTION_IDS.demos}
              >
                {t.hero.ctaPrimary}
              </PillButton>
              <PillButton
                variant="ghost"
                tone="paper"
                href={"#" + SECTION_IDS.contact}
              >
                {t.hero.ctaSecondary}
              </PillButton>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
