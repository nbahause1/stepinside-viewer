"use client";

import { useState } from "react";
import { List, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import { SECTION_IDS } from "@/lib/config";

/*
  Top navigation bar. Not sticky. Light theme only, no shadows, no gradients.
  Kept deliberately minimal: the start page is a single scroll, so there are no
  in-page section anchors here (they only scrolled down and back up). The nav
  carries the standalone "Ueber uns" route, the language switch, and the primary
  contact CTA.
*/
export default function Nav() {
  const { t, lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  // Shared visible focus state for the hand-rolled controls (PillButton has its own).
  const focusRing =
    "rounded-[2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:ring-offset-2 focus-visible:ring-offset-parchment";

  const LangSwitch = ({ className = "" }: { className?: string }) => (
    <span
      aria-label={t.nav.langSwitchAria}
      className={"flex items-center gap-2 text-[13px] " + className}
    >
      <button
        type="button"
        onClick={() => setLang("de")}
        aria-pressed={lang === "de"}
        className={
          "transition-colors " +
          focusRing +
          " " +
          (lang === "de"
            ? "font-bold text-ink"
            : "text-dim hover:text-ink font-normal")
        }
      >
        DE
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        className={
          "transition-colors " +
          focusRing +
          " " +
          (lang === "en"
            ? "font-bold text-ink"
            : "text-dim hover:text-ink font-normal")
        }
      >
        EN
      </button>
    </span>
  );

  return (
    <nav aria-label={t.nav.ariaLabel} className="bg-parchment border-b border-bone">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 md:h-[72px]">
        {/* Logo lockup */}
        <a href="/" className={"flex items-center gap-2.5 " + focusRing}>
          <span aria-hidden className="block size-2 rotate-45 bg-ink" />
          <span className="text-[15px] font-bold text-ink">StepInside</span>
        </a>

        {/* Right cluster */}
        <div className="flex items-center gap-4 lg:gap-5">
          <a
            href="/ueber-uns"
            className={
              "hidden text-[14px] text-ink transition-opacity hover:opacity-70 lg:inline-block " +
              focusRing
            }
          >
            {t.nav.about}
          </a>

          <div className="hidden lg:flex">
            <LangSwitch />
          </div>

          {/* Wrapper controls visibility: a `hidden` class on PillButton itself
              loses to its base inline-flex, so gate it from the outside. */}
          <div className="hidden sm:block">
            <PillButton href={"/#" + SECTION_IDS.contact} variant="pill" tone="ink">
              {t.nav.cta}
            </PillButton>
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t.nav.close : t.nav.menu}
            aria-expanded={open}
            className={
              "text-ink transition-opacity hover:opacity-70 lg:hidden " + focusRing
            }
          >
            {open ? <X size={22} aria-hidden /> : <List size={22} aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="border-b border-bone bg-parchment px-6 py-6 lg:hidden">
          <div className="flex flex-col gap-4">
            <a
              href="/ueber-uns"
              onClick={() => setOpen(false)}
              className={
                "text-[16px] text-ink transition-opacity hover:opacity-70 " + focusRing
              }
            >
              {t.nav.about}
            </a>
            <LangSwitch />
            <PillButton
              href={"/#" + SECTION_IDS.contact}
              variant="pill"
              tone="ink"
              onClick={() => setOpen(false)}
              className="w-full"
            >
              {t.nav.cta}
            </PillButton>
          </div>
        </div>
      )}
    </nav>
  );
}
