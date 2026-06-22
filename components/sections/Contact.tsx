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
  on the right. Aker treatment — light paper canvas, hairline mist borders,
  ghost/filled pills, Ember reserved for the inline email/phone links. No shadows,
  no gradients.
*/
export default function Contact() {
  const { t } = useLang();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

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

  const fieldClass =
    "mt-2 w-full rounded-[8px] border border-mist bg-paper px-4 py-3 text-[15px] text-ink transition-colors placeholder:text-smoke focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink";

  return (
    <section id={SECTION_IDS.contact} className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal>
          <SectionLabel tone="light">{t.contact.label}</SectionLabel>
          <h2 className="mt-4 font-light leading-[1.1] tracking-[-0.02em] text-ink text-[36px] md:text-[clamp(2.25rem,4vw,3.5rem)]">
            {t.contact.heading}
          </h2>
          <p className="mt-5 max-w-[55ch] text-[17px] text-pewter">{t.contact.intro}</p>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {/* LEFT: Formspree form. The endpoint id comes from config / NEXT_PUBLIC_FORMSPREE_ID. */}
          <Reveal as="div">
            <form onSubmit={onSubmit} noValidate>
              <div className="space-y-6">
                <div>
                  <label htmlFor="name" className="mb-2 block text-[14px] text-pewter">
                    {t.contact.nameLabel}
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    placeholder={t.contact.namePlaceholder}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="email" className="mb-2 block text-[14px] text-pewter">
                    {t.contact.emailLabel}
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    placeholder={t.contact.emailPlaceholder}
                    className={fieldClass}
                  />
                </div>

                <div>
                  <label htmlFor="message" className="mb-2 block text-[14px] text-pewter">
                    {t.contact.messageLabel}
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    required
                    placeholder={t.contact.messagePlaceholder}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="mt-6">
                <PillButton
                  type="submit"
                  variant="filled"
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
                  <span className="text-[14px] text-pewter">{t.contact.error}</span>
                )}
              </p>
            </form>
          </Reveal>

          {/* RIGHT: direct contact details. */}
          <Reveal as="div" delay={0.05}>
            <h3 className="text-[14px] tracking-[0.12px] text-smoke">{t.contact.directLabel}</h3>
            <div className="mt-5 space-y-4 text-[15px]">
              <p className="flex items-center gap-2">
                <EnvelopeSimple size={16} aria-hidden className="text-pewter" />
                <a href={"mailto:" + config.email} className="text-ember hover:opacity-70">
                  {config.email}
                </a>
              </p>
              <p className="flex items-center gap-2">
                <Phone size={16} aria-hidden className="text-pewter" />
                <a href={"tel:" + config.phoneHref} className="text-ember hover:opacity-70">
                  {config.phone}
                </a>
              </p>
              {/* The booking pill only renders once config.calendlyUrl is set (TODO). */}
              {config.calendlyUrl ? (
                <p className="mt-2 block">
                  <PillButton
                    variant="ghost"
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
