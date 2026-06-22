"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LanguageProvider";

/*
  Site footer. Aker quiet close: a paper band with a single hairline top border,
  a monumental whisper-weight brand wordmark with tagline, then a hairline row
  carrying the legal nav and copyright. Flat and editorial — no shadows, no
  fills, no chromatic colour beyond the Ember link hover.
*/
export default function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();
  const focusRing =
    "rounded-[3.2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

  return (
    <footer className="bg-paper border-t border-mist">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        {/* Brand wordmark — the Aker signature */}
        <div className="text-[clamp(2.5rem,9vw,5.5rem)] font-light leading-[0.9] tracking-[-0.02em] text-ink">
          StepInside
        </div>
        <p className="mt-4 max-w-[40ch] text-[15px] text-pewter">
          {t.footer.tagline}
        </p>

        {/* Legal nav + copyright */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-6 border-t border-mist pt-8">
          <nav
            aria-label={t.footer.legalAria}
            className="flex flex-wrap items-center gap-6"
          >
            <Link
              href="/impressum"
              className={
                "text-[14px] text-ink transition-colors hover:text-ember " +
                focusRing
              }
            >
              {t.footer.impressum}
            </Link>
            <Link
              href="/datenschutz"
              className={
                "text-[14px] text-ink transition-colors hover:text-ember " +
                focusRing
              }
            >
              {t.footer.datenschutz}
            </Link>
          </nav>

          <p className="text-[13px] text-smoke">
            {"©"} {year} StepInside. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
