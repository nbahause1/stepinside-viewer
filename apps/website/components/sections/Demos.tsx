"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowsOut, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: the walkable scan. The viewer is heavy (a continuously-rendering WebGL/
  WebGPU splat scene), so it is NOT embedded in the page flow — a live iframe
  there would render in the background and jank the whole page's scrolling. We
  show a static cover instead and only MOUNT the viewer when the visitor opens
  it ("Vollbild"). It then lives in a fixed full-viewport overlay; collapsing it
  hides the iframe (display:none → the browser throttles its rendering) but keeps
  it mounted, so re-opening is instant and the tour keeps its state.
*/
export default function Demos() {
  const { t } = useLang();
  const [launched, setLaunched] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const open = () => {
    setLaunched(true);
    setExpanded(true);
  };

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

        {/* Static cover in the page flow — no iframe here, so the heavy scan is
            never loaded or rendered while scrolling the page. */}
        <div
          id={SECTION_IDS.gate}
          className="relative mx-auto mt-12 aspect-[3/4] w-full max-w-[1100px] scroll-mt-20 overflow-hidden rounded-[12px] border border-ink/10 bg-ink shadow-[0_24px_70px_-30px_rgba(0,0,0,0.5)] sm:aspect-[4/3] md:aspect-video"
        >
          {/* Still frame from the scan as the cover preview — the visitor sees
              the space before the heavy viewer is ever loaded. */}
          <Image
            src="/scan-1.jpg"
            alt=""
            fill
            sizes="(max-width: 1148px) 100vw, 1100px"
            className="object-cover"
          />
          {/* Subtle dark gradient so the launch button and hint stay readable
              over the photograph. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to bottom, rgba(10,10,10,0.25), rgba(10,10,10,0.15) 40%, rgba(10,10,10,0.55))",
            }}
          />
          <button
            type="button"
            onClick={open}
            aria-label={t.demos.fullscreen}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <span className="inline-flex items-center gap-2.5 rounded-full bg-paper/10 py-3.5 pl-5 pr-6 text-[15px] font-medium text-paper ring-1 ring-paper/25 backdrop-blur-md transition-colors hover:bg-paper/20">
              <ArrowsOut size={20} weight="bold" aria-hidden />
              {t.demos.fullscreen}
            </span>
            <span className="max-w-[30ch] text-[14px] font-medium leading-[1.4] text-paper/80">
              {t.demos.fullscreenHint}
            </span>
          </button>
        </div>
      </div>

      {/* The viewer mounts only after the first launch. Fixed full-viewport when
          open; display:none when closed (rendering throttled, no page jank) but
          kept mounted for an instant, state-preserving re-open. Rendered outside
          any transformed/filtered ancestor so position:fixed covers the viewport. */}
      {launched && (
        <div className={expanded ? "fixed inset-0 z-[100] bg-ink" : "hidden"}>
          <iframe
            src={config.viewerEmbedUrl}
            title={t.demos.heading}
            allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope"
            className="absolute inset-0 h-full w-full border-0"
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t.demos.exitFullscreen}
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink/55 text-paper backdrop-blur-md transition-colors hover:bg-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/60"
          >
            <X size={20} weight="bold" aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
