"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import DiamondGrid from "@/components/ui/DiamondGrid";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Audience: a light card grid answering "who it's for". Reads as a calm set of
  parchment-on-white cards, deliberately distinct from the dark list in Process.
  No shadows, no gradients, depth from 1px hairlines and tonal surfaces only.
*/
export default function Audience() {
  const { t } = useLang();

  return (
    <section id={SECTION_IDS.audience} className="bg-parchment">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <SectionLabel tone="light">{t.audience.label}</SectionLabel>
          <h2 className="mt-5 text-3xl font-bold tracking-[-0.02em] md:text-[40px]">
            {t.audience.heading}
          </h2>
          <p className="mt-4 max-w-[60ch] text-[17px] text-charcoal">
            {t.audience.intro}
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {t.audience.items.map((item, i) => (
            <Reveal key={i} delay={Math.min(i * 0.05, 0.25)}>
              <div className="flex h-full flex-col rounded-[4px] border border-bone bg-pure-white p-6">
                <DiamondGrid n={3} className="text-ash" />
                <h3 className="mt-5 text-[18px] font-bold text-ink">
                  {item.title}
                </h3>
                <p className="mt-2 text-[15px] leading-[1.5] text-dim">
                  {item.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
