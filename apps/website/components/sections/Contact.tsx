"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
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
  const year = new Date().getFullYear();
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

    // Mirror the lead into the CRM (GHL Speed-to-Lead workflow) via our own
    // server proxy at /api/lead. Fire-and-forget: Formspree stays the source of
    // truth for the visible success state, so a CRM hiccup never blocks or
    // delays the visitor.
    const lead = new FormData(form);
    void fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: lead.get("name"),
        email: lead.get("email"),
        message: lead.get("message"),
      }),
    }).catch(() => {});

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
    "mt-2 w-full rounded-[8px] border border-char bg-paper px-4 py-3 text-[15px] text-ink transition-colors placeholder:text-smoke focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink";

  return (
    <section id={SECTION_IDS.contact} className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal>
          <h2 className="font-light leading-[1.1] tracking-[-0.02em] text-ink text-[36px] md:text-[clamp(2.25rem,4vw,3.5rem)]">
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

          {/* RIGHT: direct contact details above the big innsyn wordmark. */}
          <Reveal
            as="div"
            delay={0.05}
            className="flex h-full flex-col justify-end gap-12"
          >
            {/* Direct phone — the fast lane past the form. Ember is reserved
                for exactly these inline links (Aker treatment). */}
            <div className="lg:text-right">
              <p className="text-[14px] text-pewter">{t.contact.directLabel}</p>
              {/* Ember at rest so the links read as links without hover (touch
                  devices never hover); each row is a >=44px tap target. */}
              <div className="mt-2 flex flex-col lg:items-end">
                <a
                  href={`tel:${config.phoneHref}`}
                  className="flex min-h-11 items-center py-2 text-[17px] text-ember transition-colors hover:text-ink"
                >
                  {config.phone}
                </a>
                {/* Booking link appears only once a Calendly URL is configured. */}
                {config.calendlyUrl && (
                  <a
                    href={config.calendlyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-11 items-center py-2 text-[17px] text-ember transition-colors hover:text-ink"
                  >
                    {t.contact.bookLabel}
                  </a>
                )}
              </div>
            </div>
            {/* Big brand wordmark filling the empty right-hand space. The
                lg:mb lifts it so its bottom lines up with the message box's
                bottom edge (clearing the send-button area below the textarea). */}
            <div className="lg:mb-[81px] lg:text-right">
              <div className="flex items-center gap-[clamp(1rem,2.5vw,2rem)] lg:justify-end">
                <span className="text-[clamp(2rem,5.5vw,3.5rem)] font-light leading-[0.9] tracking-[-0.02em] text-ink">
                  innsyn
                </span>
                {/* Brand mark: a diamond that bounces — it hops up (ease-out,
                    decelerating like gravity), rotates 90° clockwise mid-air,
                    and falls back down (ease-in, accelerating). A SEPARATE
                    ground shadow stays on the floor: it shrinks + fades while the
                    diamond is airborne and pops bigger + darker on impact. The
                    diamond is 4-fold symmetric, so the loop's invisible reset
                    from 135°→45° reads as continuous clockwise ticking.
                    Keyframes are inlined so they survive the Tailwind v4 build;
                    the global reduced-motion override stills them. */}
                <style>{`
                  @keyframes diamondBounce {
                    0%, 33% {
                      transform: translateY(0) rotate(45deg);
                      animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
                    }
                    51% {
                      transform: translateY(-20px) rotate(90deg);
                      animation-timing-function: cubic-bezier(0.55, 0.085, 0.68, 0.53);
                    }
                    65% {
                      transform: translateY(0) rotate(135deg);
                      animation-timing-function: cubic-bezier(0.215, 0.61, 0.355, 1);
                    }
                    72% {
                      transform: translateY(-5px) rotate(135deg);
                      animation-timing-function: cubic-bezier(0.55, 0.085, 0.68, 0.53);
                    }
                    78%, 100% {
                      transform: translateY(0) rotate(135deg);
                    }
                  }
                  @keyframes diamondShadow {
                    0%, 33% {
                      transform: translateX(-50%) scaleX(1);
                      opacity: 0.3;
                      animation-timing-function: cubic-bezier(0.3, 0, 0.25, 1);
                    }
                    51% {
                      transform: translateX(-50%) scaleX(0.45);
                      opacity: 0.07;
                      animation-timing-function: cubic-bezier(0.5, 0.05, 0.7, 0.5);
                    }
                    65% {
                      transform: translateX(-50%) scaleX(1.12);
                      opacity: 0.36;
                    }
                    72% {
                      transform: translateX(-50%) scaleX(0.82);
                      opacity: 0.24;
                    }
                    78%, 100% {
                      transform: translateX(-50%) scaleX(1);
                      opacity: 0.3;
                    }
                  }
                `}</style>
                <span className="relative inline-flex w-[clamp(1.5rem,3.5vw,2.5rem)] shrink-0 items-center justify-center">
                  {/* Ground contact shadow (stays on the floor). */}
                  <span
                    aria-hidden
                    className="absolute left-1/2 top-[calc(100%+3px)] h-[6px] w-[85%] rounded-[50%] bg-ink blur-[2.5px]"
                    style={{
                      animation: "diamondShadow 1.5s linear infinite",
                    }}
                  />
                  {/* The bouncing, spinning diamond. */}
                  <span
                    aria-hidden
                    className="block aspect-square w-full bg-ink"
                    style={{
                      animation: "diamondBounce 1.5s linear infinite",
                    }}
                  />
                </span>
              </div>
              <p className="mt-3 max-w-[34ch] text-[15px] text-pewter lg:ml-auto">
                {t.footer.tagline}
              </p>
            </div>
          </Reveal>
        </div>

        {/* Thin legal strip across the full width: Impressum / Datenschutz on
            the left, copyright on the right. */}
        <Reveal
          as="div"
          className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-sand pt-6 md:mt-20"
        >
          <nav
            aria-label={t.footer.legalAria}
            className="flex flex-wrap items-center gap-6"
          >
            <Link
              href="/ueber-uns"
              className="text-[14px] text-ink transition-colors hover:text-ember"
            >
              {t.footer.about}
            </Link>
            <Link
              href="/impressum"
              className="text-[14px] text-ink transition-colors hover:text-ember"
            >
              {t.footer.impressum}
            </Link>
            <Link
              href="/datenschutz"
              className="text-[14px] text-ink transition-colors hover:text-ember"
            >
              {t.footer.datenschutz}
            </Link>
          </nav>
          <p className="text-[13px] text-smoke">
            {"©"} {year} innsyn
          </p>
        </Reveal>
      </div>
    </section>
  );
}
