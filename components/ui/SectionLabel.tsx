import type { ReactNode } from "react";

interface SectionLabelProps {
  children: ReactNode;
  /** "light" = smoke on paper, "dark" = mist on dark surfaces. */
  tone?: "light" | "dark";
  className?: string;
}

/*
  Aker overline: a small, quiet label sitting above a section heading, left-aligned,
  sentence case (not uppercase). 12px, weight 400, smoke. The heading does the work;
  this just classifies it.
*/
export default function SectionLabel({
  children,
  tone = "light",
  className = "",
}: SectionLabelProps) {
  const color = tone === "light" ? "text-smoke" : "text-mist";
  return (
    <span
      className={`block text-[12px] font-normal leading-none tracking-[0.12px] ${color} ${className}`}
    >
      {children}
    </span>
  );
}
