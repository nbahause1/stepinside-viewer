"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: a stacked-media section. Each item pairs a short caption with a live scan
  embed (SuperSplat / iframe). Slots without a configured URL render a quiet dark
  panel placeholder instead. No overlaid pills, labels, or counters.
*/
export default function Demos() {
  const { t } = useLang();
  const items = t.demos.items as { title: string; body: string }[];

  return (
    <section id={SECTION_IDS.demos} className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal>
          <h2 className="max-w-[16ch] text-[36px] font-light leading-[1.05] tracking-[-0.025em] text-ink md:text-[clamp(2.5rem,5vw,4rem)]">
            {t.demos.heading}
          </h2>
          <p className="mt-5 max-w-[60ch] text-[17px] text-pewter">
            {t.demos.intro}
          </p>
        </Reveal>

        {items.map((item, i) => {
          const url = config.demoEmbeds[i] ?? "";

          return (
            <Reveal key={item.title} className={i === 0 ? "mt-12" : "mt-16"}>
              <h3 className="text-[22px] font-normal text-ink">{item.title}</h3>
              <p className="mt-1 max-w-[60ch] text-[15px] text-pewter">
                {item.body}
              </p>

              <div className="relative mt-6 aspect-video w-full overflow-hidden rounded-[8px]">
                {url ? (
                  <div className="absolute inset-0 bg-midnight">
                    <iframe
                      src={url}
                      title={item.title}
                      loading="lazy"
                      allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full border-0"
                    />
                  </div>
                ) : (
                  // TODO: paste the SuperSplat/iframe embed URL into config.demoEmbeds[i]
                  <div className="absolute inset-0 flex items-center justify-center bg-midnight">
                    <span className="text-[13px] tracking-[0.12px] text-mist/70">
                      {t.demos.placeholder}
                    </span>
                  </div>
                )}
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
