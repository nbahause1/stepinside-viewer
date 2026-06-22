"use client";

import { useState } from "react";
import { List, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import PillButton from "@/components/ui/PillButton";
import { SECTION_IDS } from "@/lib/config";

/*
  Aker "Navigation Pill". A single compact floating dark pill in the top-right
  corner — the only chrome, floating over the hero video and every section.
  Tapping the pill toggles a small dark menu panel anchored beneath it.

  Content is unchanged from the previous version: the standalone "Über uns"
  route, the DE/EN language switch, and the primary contact CTA. There are no
  in-page section anchors (the start page is a single scroll). Flat char
  surfaces, hairline borders, no shadows, no gradients.
*/
export default function Nav() {
  const { t, lang, setLang } = useLang();
  const [open, setOpen] = useState(false);

  // Visible focus ring tuned for the dark char surfaces of the pill + panel.
  const focusRing =
    "rounded-[3.2px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/50 focus-visible:ring-offset-2 focus-visible:ring-offset-char";

  return (
    <nav
      aria-label={t.nav.ariaLabel}
      className="fixed right-4 top-4 z-50 md:right-6 md:top-6"
    >
      <div className="relative">
        {/* The pill itself toggles the menu. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? t.nav.close : t.nav.menu}
          aria-expanded={open}
          className={
            "inline-flex items-center gap-2 rounded-[1584px] bg-char px-4 py-2 text-paper " +
            "transition-colors duration-200 ease-out hover:bg-iron " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper"
          }
        >
          <span className="text-[13px] font-medium tracking-[0.12px]">StepInside</span>
          {open ? (
            <X size={18} weight="regular" aria-hidden />
          ) : (
            <List size={18} weight="regular" aria-hidden />
          )}
        </button>

        {/* Menu panel — anchored under the pill, flat char surface. */}
        {open && (
          <div className="absolute right-0 mt-2 w-[min(88vw,320px)] rounded-[8px] border border-paper/10 bg-char p-4 text-paper">
            <div className="flex flex-col gap-4">
              <a
                href="/ueber-uns"
                onClick={() => setOpen(false)}
                className={
                  "text-[15px] text-paper transition-colors hover:text-mist " + focusRing
                }
              >
                {t.nav.about}
              </a>

              {/* DE / EN language switch */}
              <span
                aria-label={t.nav.langSwitchAria}
                className="flex items-center gap-3 text-[15px]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setLang("de");
                    setOpen(false);
                  }}
                  aria-pressed={lang === "de"}
                  className={
                    "transition-colors " +
                    focusRing +
                    " " +
                    (lang === "de"
                      ? "font-medium text-paper"
                      : "font-normal text-mist hover:text-paper")
                  }
                >
                  DE
                </button>
                <span aria-hidden className="text-paper/20">
                  /
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLang("en");
                    setOpen(false);
                  }}
                  aria-pressed={lang === "en"}
                  className={
                    "transition-colors " +
                    focusRing +
                    " " +
                    (lang === "en"
                      ? "font-medium text-paper"
                      : "font-normal text-mist hover:text-paper")
                  }
                >
                  EN
                </button>
              </span>

              <div className="mt-1 border-t border-paper/10 pt-4">
                <PillButton
                  href={"/#" + SECTION_IDS.contact}
                  variant="ghost"
                  tone="paper"
                  onClick={() => setOpen(false)}
                  className="w-full justify-between"
                >
                  {t.nav.cta}
                </PillButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
