"use client";

import { useLang } from "@/components/i18n/LanguageProvider";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import RoomWireframe from "@/components/illustrations/RoomWireframe";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: a stacked-media section. Each item pairs a short caption with a live scan
  embed (SuperSplat / iframe). Slots without a configured URL render a quiet
  wireframe placeholder instead. No overlaid pills, labels, or counters.
*/
export default function Demos() {
  const { t } = useLang();
  const items = t.demos.items as { title: string; body: string }[];

  return (
    <section id={SECTION_IDS.demos} className="bg-parchment">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <SectionLabel tone="light">{t.demos.label}</SectionLabel>
          <h2 className="mt-5 text-3xl font-bold leading-[1.15] tracking-[-0.02em] md:text-[40px]">
            {t.demos.heading}
          </h2>
          <p className="mt-4 max-w-[60ch] text-[17px] text-charcoal">
            {t.demos.intro}
          </p>
        </Reveal>

        {items.map((item, i) => {
          const url = config.demoEmbeds[i] ?? "";

          return (
            <Reveal key={item.title} className={i === 0 ? "mt-12" : "mt-14"}>
              <h3 className="text-[20px] font-bold text-ink">{item.title}</h3>
              <p className="mt-2 max-w-[60ch] text-[15px] text-dim">
                {item.body}
              </p>

              <div className="relative mt-5 aspect-video w-full overflow-hidden rounded-[4px] border border-bone bg-pure-white">
                {url ? (
                  <iframe
                    src={url}
                    title={item.title}
                    loading="lazy"
                    allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full border-0"
                  />
                ) : (
                  // TODO: paste the SuperSplat/iframe embed URL into config.demoEmbeds[i]
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
                    <RoomWireframe className="w-40 text-bone" decorative />
                    <span className="text-[13px] text-dim">
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
