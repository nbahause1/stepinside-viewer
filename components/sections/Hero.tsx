"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Hero (Aker): a full-bleed muted background video opens the page like a darkroom
  gallery wall. A single flat ink scrim keeps the white text legible (no gradient,
  no shadow). The monumental whisper-weight headline anchors the bottom-left in
  wordmark style, with one exclusive "request a demo" email capture beneath it.
  The video is a silent, looping ambient backdrop; a poster paints instantly while
  it loads. The walkable scans remain the star further down the page.
*/
export default function Hero() {
  const { t } = useLang();
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
    status === "success"
      ? t.hero.requestSuccess
      : status === "error"
        ? t.hero.requestError
        : t.hero.requestHint;

  return (
    <section
      id={SECTION_IDS.top}
      className="relative isolate flex min-h-[100svh] overflow-hidden bg-midnight"
    >
      <video
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/hero-poster.jpg"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute inset-0 h-full w-full object-cover"
      >
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {/* Flat ink scrim for text legibility (no gradient, no shadow). */}
      <div aria-hidden="true" className="absolute inset-0 bg-ink/55" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col justify-end px-6 py-24 md:py-28">
        <Reveal delay={0.1}>
          <h1 className="max-w-[16ch] text-[clamp(2.75rem,8vw,7rem)] font-light leading-[0.92] tracking-[-0.025em] text-paper">
            {t.hero.headline}
          </h1>

          {/* Exclusive request-a-demo email capture (posts to Formspree). */}
          <form onSubmit={onSubmit} noValidate className="mt-10 max-w-[460px]">
            <div className="flex items-center gap-4 border-b border-paper/40 transition-colors focus-within:border-paper">
              <label htmlFor="hero-email" className="sr-only">
                {t.hero.emailPlaceholder}
              </label>
              <input
                id="hero-email"
                type="email"
                name="email"
                required
                placeholder={t.hero.emailPlaceholder}
                className="w-full bg-transparent py-3 text-[15px] text-paper placeholder:text-paper/50 focus:outline-none"
              />
              <input
                type="hidden"
                name="_subject"
                value="Demo-Anfrage über die Website"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap py-3 text-[15px] text-paper transition-opacity hover:opacity-70 disabled:pointer-events-none disabled:opacity-50"
              >
                {status === "loading" ? t.hero.requesting : t.hero.ctaPrimary}
                <ArrowRight
                  size={16}
                  weight="regular"
                  aria-hidden
                  className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
                />
              </button>
            </div>
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-[13px] text-paper/60"
            >
              {message}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  );
}
