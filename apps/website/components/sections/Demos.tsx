"use client";

import { useEffect, useState } from "react";
import { ArrowsOut, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: the walkable scan is embedded live via iframe (bundled at /viewer/).
  Because the viewer sizes its own UI to the iframe, a small embed box looks
  cramped on phones — so a "Vollbild" control expands the iframe to a fixed,
  full-viewport overlay. This is a plain CSS overlay (not the Fullscreen API),
  which is the only approach that works on iOS Safari, and toggling it never
  remounts the iframe, so the tour keeps its state.
*/
export default function Demos() {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);

  // While fullscreen: lock the page behind it and let Esc close it.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <section
      id={SECTION_IDS.demos}
      className="overflow-x-clip border-t border-ink/10 bg-paper"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal className="text-center">
          <h2 className="text-[36px] font-light leading-[1.05] tracking-[-0.025em] text-ink md:text-[clamp(2.5rem,5vw,4rem)]">
            {t.demos.heading}
          </h2>
          <p className="mx-auto mt-5 max-w-[60ch] text-[17px] leading-[1.5] text-pewter">
            {t.demos.intro}
          </p>
        </Reveal>

        {/* Live walkable scan. The container switches between a framed box and a
            fixed full-viewport overlay; the <iframe> stays mounted across both.
            NOT wrapped in <Reveal>: its animated filter/transform would establish
            a containing block and trap position:fixed inside the small box. */}
        <div
          id={SECTION_IDS.gate}
          className={
            expanded
              ? "fixed inset-0 z-[100] bg-ink"
              : "relative mx-auto mt-12 aspect-[3/4] w-full max-w-[1100px] scroll-mt-20 overflow-hidden rounded-[12px] border border-ink/10 bg-ink/95 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.5)] sm:aspect-[4/3] md:aspect-video"
          }
        >
          {/* Collapsed: the first frame is blurred and the iframe is inert, so
              the scan can't be used in the small box — you have to open
              fullscreen to actually see and walk it. Expanded: sharp + live. */}
          <iframe
            src={config.viewerEmbedUrl}
            title={t.demos.heading}
            loading="lazy"
            allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope"
            className={
              "absolute inset-0 h-full w-full border-0 " +
              (expanded ? "" : "scale-[1.08] blur-[14px] pointer-events-none")
            }
          />

          {expanded ? (
            // Compact icon-only close, top-right, clear of the viewer's centred
            // brand badge on narrow phones.
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label={t.demos.exitFullscreen}
              className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink/55 text-paper backdrop-blur-md transition-colors hover:bg-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/60"
            >
              <X size={20} weight="bold" aria-hidden />
            </button>
          ) : (
            // Over the blurred frame: a soft veil, one clear call to open
            // fullscreen, and a line telling the visitor why. This is the only
            // interactive control while collapsed.
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-ink/30 px-6 text-center">
              <button
                type="button"
                onClick={() => setExpanded(true)}
                aria-label={t.demos.fullscreen}
                className="inline-flex items-center gap-2.5 rounded-full bg-ink/65 py-3.5 pl-5 pr-6 text-[15px] font-medium text-paper backdrop-blur-md transition-colors hover:bg-ink/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/60"
              >
                <ArrowsOut size={20} weight="bold" aria-hidden />
                {t.demos.fullscreen}
              </button>
              <p className="max-w-[28ch] text-[14px] font-medium leading-[1.4] text-paper/85">
                {t.demos.fullscreenHint}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
