"use client";

import { useState } from "react";
import { Plus } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { SECTION_IDS } from "@/lib/config";

/*
  Process: "how we work" as an interactive numbered ledger (Aker accordion). Each
  step is a clickable row — the ink title + a thin plus that rotates into an ×;
  clicking it smoothly expands the pewter description (grid-rows 0fr→1fr, no magic
  numbers). One row open at a time; the first is open by default so the pattern
  reads immediately. Hairline dividers, smoke ordinals. No fill, no shadows, no
  gradients — separation from the white neighbours comes from a hairline top/bottom.
*/
export default function Process() {
  const { t } = useLang();
  const { heading, intro, steps } = t.process;
  // First step open by default so the expand affordance is self-evident.
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section
      id={SECTION_IDS.process}
      className="border-y border-ink/10 bg-paper text-ink"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-36">
        <Reveal>
          <h2 className="text-[36px] font-light leading-[1.1] tracking-[-0.02em] text-ink md:text-[clamp(2.25rem,4vw,3.5rem)]">
            {heading}
          </h2>
          <p className="mt-5 max-w-[60ch] whitespace-pre-line text-[17px] text-pewter">{intro}</p>
        </Reveal>

        <div className="mt-16">
          {steps.map((step, i) => {
            const open = openIndex === i;
            const ord = String(i + 1).padStart(2, "0");
            return (
              <Reveal
                as="div"
                key={i}
                delay={i * 0.05}
                className={i > 0 ? "border-t border-ink/10" : ""}
              >
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(open ? -1 : i)}
                    aria-expanded={open}
                    aria-controls={`process-panel-${i}`}
                    className="group flex w-full cursor-pointer items-baseline gap-6 py-7 text-left"
                  >
                    <span className="w-8 shrink-0 text-[13px] tabular-nums text-smoke">
                      {ord}
                    </span>
                    <span className="flex-1 text-[22px] font-normal text-ink transition-colors duration-200 ease-out group-hover:text-pewter">
                      {step.title}
                    </span>
                    <Plus
                      size={20}
                      weight="thin"
                      aria-hidden
                      className={`mt-1 shrink-0 transition-[transform,color] duration-300 ease-out ${
                        open
                          ? "rotate-45 text-ink"
                          : "text-smoke group-hover:text-ink"
                      }`}
                    />
                  </button>
                </h3>

                {/* Smoothly collapsing panel via grid-rows 0fr→1fr. */}
                <div
                  id={`process-panel-${i}`}
                  role="region"
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="max-w-[56ch] pb-7 pl-14 text-[15px] leading-[1.5] text-pewter">
                      {step.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
