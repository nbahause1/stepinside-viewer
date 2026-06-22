"use client";

import Link from "next/link";
import { useLang } from "@/components/i18n/LanguageProvider";

/*
  Site footer. Pravah quiet close: a parchment band with a single hairline top
  border, the brand lockup with tagline on the left, the legal nav on the right,
  and a thin copyright line below. No shadows, no fills, no chromatic colour.
*/
export default function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();
  const focusRing =
    "rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-parchment";

  return (
    <footer className="bg-parchment border-t border-bone">
      <div className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* Brand lockup */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className="block size-2 rotate-45 bg-ink"
                aria-hidden="true"
              />
              <span className="text-[15px] font-bold text-ink">StepInside</span>
            </div>
            <p className="mt-3 max-w-[40ch] text-[14px] text-dim">
              {t.footer.tagline}
            </p>
          </div>

          {/* Legal nav */}
          <nav
            aria-label={t.footer.legalAria}
            className="flex flex-col gap-3 sm:flex-row sm:gap-6"
          >
            <Link
              href="/impressum"
              className={"text-[14px] text-ink hover:opacity-70 " + focusRing}
            >
              {t.footer.impressum}
            </Link>
            <Link
              href="/datenschutz"
              className={"text-[14px] text-ink hover:opacity-70 " + focusRing}
            >
              {t.footer.datenschutz}
            </Link>
          </nav>
        </div>

        {/* Copyright line */}
        <div className="mt-10 flex border-t border-bone pt-6">
          <p className="text-[13px] text-dim">
            {"©"} {year} StepInside. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  );
}
