"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Audience: the Aker "What we do" numbered ledger. A light paper canvas with a
  quiet overline + whisper-weight heading, then each audience entry set as a
  hairline-divided row: a two-digit ordinal, a title, and a line of body copy.
  No cards, no graphics — depth comes from the border-mist hairlines and the
  size/weight contrast alone. No shadows, no gradients, no Ember accent here.
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

        <ul className="mt-16 max-w-[820px]">
          {t.audience.items.map((item, i) => (
            <Reveal key={i} as="li" delay={Math.min(i * 0.05, 0.25)}>
              <div className="flex items-baseline gap-6 border-t border-mist py-6">
                <span className="w-8 shrink-0 text-[13px] tabular-nums text-smoke">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-subheading font-normal text-ink md:text-[22px]">
                    {item.title}
                  </h3>
                  <p className="mt-1 max-w-[60ch] text-[15px] leading-[1.5] text-pewter">
                    {item.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
