"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Hero: a full-bleed muted background video with the message overlaid. A single
  flat ink scrim keeps the white text legible (no gradient, no shadow). The video
  is a silent, looping ambient backdrop; the walkable scans remain the star
  further down the page. A poster image paints instantly while the video loads.
*/
export default function Hero() {
  const { t } = useLang();

  return (
    <section
      id={SECTION_IDS.top}
      className="relative isolate flex min-h-[560px] items-center overflow-hidden bg-aubergine md:min-h-[86svh]"
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

      {/* Flat scrim for text legibility (no gradient, no shadow). */}
      <div aria-hidden="true" className="absolute inset-0 bg-ink/55" />

      <div className="relative z-10 mx-auto w-full max-w-[1200px] px-6 py-24 md:py-28">
        <div className="max-w-[640px]">
          <Reveal delay={0}>
            <SectionLabel tone="dark">{t.hero.label}</SectionLabel>
          </Reveal>

          <Reveal delay={0.08}>
            <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-[-0.02em] text-pure-white md:text-5xl lg:text-[56px]">
              {t.hero.headline}
            </h1>
          </Reveal>

          <Reveal delay={0.16}>
            <p className="mt-6 max-w-[48ch] text-[17px] leading-[1.5] text-pure-white/85">
              {t.hero.sub}
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-wrap gap-3">
              <PillButton
                variant="pill"
                tone="white"
                href={"#" + SECTION_IDS.demos}
              >
                {t.hero.ctaPrimary}
              </PillButton>
              <PillButton
                variant="square"
                tone="white"
                href={"#" + SECTION_IDS.contact}
              >
                {t.hero.ctaSecondary}
              </PillButton>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
