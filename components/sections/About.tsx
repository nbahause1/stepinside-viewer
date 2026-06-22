"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  About: quiet editorial prose. No photo (the brief forbids photos), no cards,
  no split header. Heading stacks above a single calm column of paragraphs,
  separated by one hairline. Pravah dossier tone.
*/
export default function About() {
  const { t } = useLang();

  return (
    <section id={SECTION_IDS.about} className="bg-parchment">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <SectionLabel tone="light">{t.about.label}</SectionLabel>
          <h2 className="mt-5 max-w-[18ch] text-3xl font-bold tracking-[-0.02em] md:text-[40px]">
            {t.about.heading}
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-8 max-w-[68ch] space-y-6 border-t border-bone pt-8">
            {t.about.paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className="text-[17px] leading-[1.65] text-charcoal"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
