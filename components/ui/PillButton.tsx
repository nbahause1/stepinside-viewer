import type { ReactNode } from "react";

type Tone = "ink" | "white";
type Variant = "pill" | "square";

interface PillButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: Tone;
  variant?: Variant;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  target?: string;
  rel?: string;
}

/*
  Outlined ghost button. Pravah primary CTAs use a 100px pill radius; secondary
  actions in dense areas use a 4px square radius. No fills, no shadows. Tone
  switches the stroke/text colour for use on light vs dark (aubergine) sections.
  The hover/active states are intentionally subtle (Emil Kowalski restraint).
*/
export default function PillButton({
  children,
  href,
  onClick,
  type = "button",
  tone = "ink",
  variant = "pill",
  className = "",
  disabled = false,
  target,
  rel,
  ...rest
}: PillButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 whitespace-nowrap border text-[15px] leading-none font-normal " +
    "transition-[background-color,transform,opacity] duration-150 ease-out " +
    "active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
    "disabled:opacity-50 disabled:pointer-events-none";

  const shape = variant === "pill" ? "rounded-[100px] px-5 py-2" : "rounded-[4px] px-4 py-1.5";

  const toneClasses =
    tone === "ink"
      ? "border-ink text-ink hover:bg-ink/[0.05] focus-visible:ring-ink/40 focus-visible:ring-offset-parchment"
      : "border-pure-white/70 text-pure-white hover:bg-pure-white/10 focus-visible:ring-pure-white/50 focus-visible:ring-offset-aubergine";

  const classes = `${base} ${shape} ${toneClasses} ${className}`;

  if (href) {
    return (
      <a
        href={href}
        className={classes}
        target={target}
        rel={rel}
        aria-label={rest["aria-label"]}
      >
        {children}
      </a>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={classes}
      aria-label={rest["aria-label"]}
    >
      {children}
    </button>
  );
}
