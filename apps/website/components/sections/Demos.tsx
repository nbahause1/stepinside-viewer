"use client";

import { useEffect, useState } from "react";
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
  // The viewer boots lazily on first open, so there is a short gap before it
  // paints. We cover that gap with a still of the scene and cross-fade it away
  // once the viewer reports its first frame (postMessage from the iframe).
  const [painted, setPainted] = useState(false);

  const open = () => {
    setLaunched(true);
    setExpanded(true);
  };

  // Drop the loading poster when the viewer signals its first painted frame.
  // Fallback timeout in case the message is missed, so it never stays stuck.
  useEffect(() => {
    if (!launched || painted) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data === "viewer:firstFrame") setPainted(true);
    };
    window.addEventListener("message", onMessage);
    const fallback = setTimeout(() => setPainted(true), 12000);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(fallback);
    };
  }, [launched, painted]);

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
          {/* Soft radial highlight so the cover reads as a surface, not a void. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 90% at 50% 35%, rgba(255,255,255,0.10), rgba(255,255,255,0) 60%)",
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
          {/* Loading poster: a still of the scene shown over the iframe until the
              viewer paints, then cross-faded out. Its UI sits where the viewer's
              own chrome lands, so the swap reads as seamless. Kept mounted so the
              opacity transition can run; pointer-events-none once faded. */}
          <img
            src="/viewer-poster.jpg"
            alt=""
            aria-hidden
            className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
              painted ? "opacity-0" : "opacity-100"
            }`}
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
