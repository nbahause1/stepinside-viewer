"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import DiamondGrid from "@/components/ui/DiamondGrid";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

export default function Process() {
  const { t } = useLang();
  const { label, heading, intro, steps } = t.process;

  return (
    <section id={SECTION_IDS.process} className="bg-aubergine text-pure-white">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <SectionLabel tone="dark">{label}</SectionLabel>
          <h2 className="mt-5 text-3xl font-bold tracking-[-0.02em] text-pure-white md:text-[40px]">
            {heading}
          </h2>
          <p className="mt-4 max-w-[60ch] text-[17px] text-ash">{intro}</p>
        </Reveal>

        <div className="mt-12 max-w-[780px]">
          {steps.map((step, i) => (
            <Reveal
              as="div"
              key={i}
              delay={i * 0.05}
              className={`flex items-start gap-5 py-6${
                i > 0 ? " border-t border-pure-white/15" : ""
              }`}
            >
              <DiamondGrid n={3} className="mt-1 shrink-0 text-ash" />
              <div>
                <h3 className="text-[20px] font-bold text-pure-white">
                  {step.title}
                </h3>
                <p className="mt-2 max-w-[56ch] text-[15px] leading-[1.5] text-ash">
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
