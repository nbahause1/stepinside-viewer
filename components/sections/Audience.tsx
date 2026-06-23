"use client";

import { ArrowRight } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import DiamondGrid from "@/components/ui/DiamondGrid";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Audience: "who it's for", three cards per row. The card design is the earlier
  Pravah one (1px hairline border, 4px radius, diamond marker, bold title, body),
  recoloured to the Aker palette (warm sand hairline on a paper surface; on hover
  the border darkens and the card scales up slightly, lifting toward the viewer).
  No fills, no shadows, no gradients.
*/
export default function Audience() {
  const { t } = useLang();

  return (
    <section id={SECTION_IDS.audience} className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal>
          <h2 className="text-[36px] font-light leading-[1.1] tracking-[-0.02em] text-ink md:text-[clamp(2.25rem,4vw,3.5rem)]">
            {t.audience.heading}
          </h2>
          <p className="mt-5 max-w-[60ch] text-[17px] leading-[1.5] text-pewter">
            {t.audience.intro}
          </p>
        </Reveal>

        {/* Focus/spotlight: while one card is hovered, the OTHERS get a slight
            blur + dim so attention lands on the hovered one. Uses :has() so it
            only fires when a card itself is hovered (not the grid gaps). */}
        <style>{`
          .audience-grid:has(.audience-card:hover) .audience-card:not(:hover) {
            filter: blur(1.2px);
            opacity: 0.7;
          }
        `}</style>
        <div className="audience-grid mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 md:gap-5 lg:grid-cols-3">
          {t.audience.items.map((item, i) => (
            <Reveal key={i} delay={Math.min(i * 0.05, 0.25)}>
              <div className="audience-card group flex h-full flex-col rounded-[4px] border border-sand bg-paper p-6 transition-[border-color,transform,filter,opacity] duration-300 ease-out hover:scale-[1.03] hover:border-ink/30">
                <DiamondGrid
                  n={3}
                  className="text-smoke transition-transform duration-200 ease-out group-hover:-translate-y-0.5"
                />
                <div className="transition-transform duration-200 ease-out group-hover:-translate-y-0.5">
                  <h3 className="mt-5 text-[18px] font-bold text-ink">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-[1.5] text-pewter">
                    {item.body}
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[15px] leading-[1.5] text-ink">
                    <ArrowRight
                      size={14}
                      weight="light"
                      aria-hidden
                      className="shrink-0"
                    />
                    {item.benefit}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
