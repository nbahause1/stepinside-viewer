import type { ReactNode } from "react";

interface SectionLabelProps {
  children: ReactNode;
  /** "light" = white fill on parchment. "dark" = outlined on aubergine. */
  tone?: "light" | "dark";
  className?: string;
}

/*
  Uppercase tracked classification tag, the Pravah "field note" label. Reads like
  a section classification stamp (DEMOS, ABLAUF, KONTAKT). 12px, 0.10em tracking.
*/
export default function SectionLabel({
  children,
  tone = "light",
  className = "",
}: SectionLabelProps) {
  const toneClasses =
    tone === "light"
      ? "bg-pure-white text-ink border border-bone"
      : "bg-transparent text-pure-white border border-pure-white/30";

  return (
    <span
      className={`inline-block rounded-[4px] px-2 py-0.5 text-[12px] font-normal uppercase leading-none tracking-[0.1em] ${toneClasses} ${className}`}
    >
      {children}
    </span>
  );
}
