"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

export default function Process() {
  const { t } = useLang();
  const { label, heading, intro, steps } = t.process;

  return (
    <section id={SECTION_IDS.process} className="bg-char text-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-36">
        <Reveal>
          <SectionLabel tone="dark">{label}</SectionLabel>
          <h2 className="mt-4 text-[36px] font-light leading-[1.1] tracking-[-0.02em] text-paper md:text-[clamp(2.25rem,4vw,3.5rem)]">
            {heading}
          </h2>
          <p className="mt-5 max-w-[60ch] text-[17px] text-mist">{intro}</p>
        </Reveal>

        <div className="mt-16 max-w-[860px]">
          {steps.map((step, i) => (
            <Reveal
              as="div"
              key={i}
              delay={i * 0.05}
              className="flex items-baseline gap-6 border-t border-paper/15 py-7"
            >
              <span className="w-8 shrink-0 text-[13px] tabular-nums text-mist/70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="text-[22px] font-normal text-paper">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.5] text-mist">
                  {step.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
