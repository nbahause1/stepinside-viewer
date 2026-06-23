"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  About (Aker): quiet editorial prose on light paper. No photo, no cards, no
  shadows. A near-display whisper-weight heading stacks above a single
  left-aligned column. The first paragraph carries the site's one and only Lora
  serif accent; the rest is calm sans body in pewter.
*/
export default function About() {
  const { t } = useLang();

  return (
    <section id={SECTION_IDS.about} className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal>
          <SectionLabel tone="light">{t.about.label}</SectionLabel>
          <h2 className="mt-4 max-w-[16ch] text-[clamp(2.5rem,6vw,4.5rem)] font-light leading-[1.05] tracking-[-0.025em] text-ink">
            {t.about.heading}
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-10 max-w-[600px] space-y-6">
            {t.about.paragraphs.map((paragraph, index) =>
              index === 0 ? (
                <p
                  key={index}
                  className="font-serif text-[18px] leading-[1.6] text-ink"
                >
                  {paragraph}
                </p>
              ) : (
                <p
                  key={index}
                  className="text-[17px] leading-[1.65] text-pewter"
                >
                  {paragraph}
                </p>
              )
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
