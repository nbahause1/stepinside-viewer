"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { EnvelopeSimple, Phone } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import SectionLabel from "@/components/ui/SectionLabel";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Contact section: a Formspree-backed form on the left, direct contact details
  on the right. Quiet Pravah surfaces, 1px hairlines, no shadows or gradients.
*/
export default function Contact() {
  const { t } = useLang();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const focusRing =
    "rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-parchment";

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

  return (
    <section id={SECTION_IDS.contact} className="bg-parchment">
      <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
        <Reveal>
          <SectionLabel tone="light">{t.contact.label}</SectionLabel>
          <h2 className="mt-5 text-3xl font-bold tracking-[-0.02em] md:text-[40px]">
            {t.contact.heading}
          </h2>
          <p className="mt-4 max-w-[55ch] text-[17px] text-charcoal">{t.contact.intro}</p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* LEFT: Formspree form. The endpoint id comes from config / NEXT_PUBLIC_FORMSPREE_ID. */}
          <Reveal as="div">
            <form onSubmit={onSubmit} noValidate>
              <div className="space-y-5">
                <div>
                  <label htmlFor="name" className="text-[14px] text-ink">
                    {t.contact.nameLabel}
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    placeholder={t.contact.namePlaceholder}
                    className="mt-2 w-full rounded-[4px] border border-bone bg-pure-white px-4 py-3 text-[15px] text-ink transition-colors placeholder:text-dim focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="text-[14px] text-ink">
                    {t.contact.emailLabel}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder={t.contact.emailPlaceholder}
                    className="mt-2 w-full rounded-[4px] border border-bone bg-pure-white px-4 py-3 text-[15px] text-ink transition-colors placeholder:text-dim focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>

                <div>
                  <label htmlFor="message" className="text-[14px] text-ink">
                    {t.contact.messageLabel}
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    required
                    placeholder={t.contact.messagePlaceholder}
                    className="mt-2 w-full rounded-[4px] border border-bone bg-pure-white px-4 py-3 text-[15px] text-ink transition-colors placeholder:text-dim focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                </div>
              </div>

              <div className="mt-6">
                <PillButton
                  type="submit"
                  variant="pill"
                  tone="ink"
                  disabled={status === "loading"}
                >
                  {status === "loading" ? t.contact.sending : t.contact.send}
                </PillButton>
              </div>

              <p role="status" aria-live="polite" className="mt-3">
                {status === "success" && (
                  <span className="text-[14px] text-ink">{t.contact.success}</span>
                )}
                {status === "error" && (
                  <span className="text-[14px] text-dim">{t.contact.error}</span>
                )}
              </p>
            </form>
          </Reveal>

          {/* RIGHT: direct contact details. */}
          <Reveal as="div" delay={0.05}>
            <h3 className="text-[15px] font-bold text-ink">{t.contact.directLabel}</h3>
            <div className="mt-5 space-y-4 text-[15px] text-charcoal">
              <p className="flex items-center gap-2">
                <EnvelopeSimple size={18} aria-hidden className="text-dim" />
                <a href={"mailto:" + config.email} className={"text-ink hover:opacity-70 " + focusRing}>
                  {config.email}
                </a>
              </p>
              <p className="flex items-center gap-2">
                <Phone size={18} aria-hidden className="text-dim" />
                <a href={"tel:" + config.phoneHref} className={"text-ink hover:opacity-70 " + focusRing}>
                  {config.phone}
                </a>
              </p>
              {/* The booking pill only renders once config.calendlyUrl is set (TODO). */}
              {config.calendlyUrl ? (
                <p className="mt-2 block">
                  <PillButton
                    variant="pill"
                    tone="ink"
                    href={config.calendlyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.contact.bookLabel}
                  </PillButton>
                </p>
              ) : null}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
