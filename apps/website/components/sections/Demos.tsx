"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import ScanField from "@/components/ui/ScanField";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: scan teaser stills create the interest; the walkable scan itself is gated
  behind an email request (Aker dark card). The stills are real frames from the
  scan video (no stock imagery). The request posts to Formspree.
*/
export default function Demos() {
  const { t } = useLang();
  const gate = t.demos.gate;
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    // The Formspree id is read from config (NEXT_PUBLIC_FORMSPREE_ID).
    if (!config.formspreeId) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("https://formspree.io/f/" + config.formspreeId, {
        method: "POST",
        headers: { Accept: "application/json" },
        body: new FormData(form),
      });
      if (res.ok) {
        setStatus("success");
        form.reset();
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  const message =
    status === "success" ? gate.success : status === "error" ? gate.error : "";

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

        {/* Scan-request box centred inside a full-bleed interactive dot field:
            the dots respond as the cursor moves toward the box. */}
        <div id={SECTION_IDS.gate} className="mt-12 scroll-mt-20">
          <Reveal>
            {/* Full-bleed: the dot field spans the whole viewport width while
                the box (max-w-620, centred by the flex) stays in the middle. */}
            <div className="relative left-1/2 flex w-screen -translate-x-1/2 items-center justify-center px-4 py-20 md:py-28">
              <ScanField />

              {/* Email gate: request a walkable scan (posts to Formspree). */}
              <div className="relative w-full max-w-[620px] overflow-hidden rounded-[8px] border border-ink/10 bg-paper px-6 py-12 text-ink md:px-12 md:py-16">
                {/* A single soft shine that glides smoothly around the box
                    edge: a rotating conic-gradient highlight, masked to the 1px
                    ring. The angle is a registered @property so it interpolates
                    cleanly (a plain custom property wouldn't animate). Raw <style>
                    so the Tailwind v4 build keeps it; reduced-motion stills it. */}
                <style>{`
                  @property --shine-angle {
                    syntax: "<angle>";
                    initial-value: 0deg;
                    inherits: false;
                  }
                  @keyframes scanShine {
                    to { --shine-angle: 360deg; }
                  }
                  .scan-box-edge {
                    position: absolute;
                    inset: 0;
                    border-radius: inherit;
                    padding: 1px;
                    background: conic-gradient(from var(--shine-angle), transparent 0deg, transparent 280deg, rgba(0,0,0,0.5) 330deg, transparent 360deg);
                    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                    -webkit-mask-composite: xor;
                    mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
                    mask-composite: exclude;
                    animation: scanShine 8s linear infinite;
                  }
                `}</style>
                <span aria-hidden className="scan-box-edge pointer-events-none" />
                <h3 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-light leading-[1.1] tracking-[-0.02em] text-ink">
                  {gate.heading}
                </h3>
                <p className="mt-4 max-w-[48ch] text-[15px] leading-[1.5] text-pewter">
                  {gate.body}
                </p>

                {/* The Formspree id comes from config / NEXT_PUBLIC_FORMSPREE_ID. */}
                <form onSubmit={onSubmit} noValidate className="mt-8 max-w-[460px]">
                  <div className="flex items-center gap-4 border-b border-ink/25 transition-colors focus-within:border-ink">
                    <label htmlFor="scan-email" className="sr-only">
                      {gate.placeholder}
                    </label>
                    <input
                      id="scan-email"
                      type="email"
                      name="email"
                      required
                      placeholder={gate.placeholder}
                      className="w-full bg-transparent py-3 text-[15px] text-ink placeholder:text-smoke focus:outline-none"
                    />
                    <input
                      type="hidden"
                      name="_subject"
                      value="Begehbarer Scan angefragt (Demos)"
                    />
                    <button
                      type="submit"
                      disabled={status === "loading"}
                      className="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap py-3 text-[15px] text-ink transition-opacity hover:opacity-60 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {status === "loading" ? gate.sending : gate.cta}
                      <ArrowRight
                        size={16}
                        weight="regular"
                        aria-hidden
                        className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                      />
                    </button>
                  </div>
                  {message && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-3 text-[13px] text-pewter"
                    >
                      {message}
                    </p>
                  )}
                </form>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
