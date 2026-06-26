import type { MouseEvent, ReactNode } from "react";
import { ArrowRight } from "@phosphor-icons/react";

type Variant = "ghost" | "outline" | "filled";
type Tone = "ink" | "paper";

interface PillButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  type?: "button" | "submit";
  /** ghost = bare text + arrow; outline = 80px pill outline; filled = dark char fill. */
  variant?: Variant;
  /** ink = on light surfaces, paper = on dark photography/surfaces. */
  tone?: Tone;
  /** Trailing right-arrow. Defaults on for ghost/outline, off for filled. */
  arrow?: boolean;
  className?: string;
  disabled?: boolean;
  target?: string;
  rel?: string;
  "aria-label"?: string;
}

/*
  Aker action affordance. Most actions are ghost text-arrow pairs; outline adds an
  80px pill stroke for emphasis; filled is the dark char pill used sparingly. Flat,
  no shadows. Single chromatic accent (Ember) is reserved for inline links, not
  these buttons.
*/
export default function PillButton({
  children,
  href,
  onClick,
  type = "button",
  variant = "ghost",
  tone = "ink",
  arrow,
  className = "",
  disabled = false,
  target,
  rel,
  ...rest
}: PillButtonProps) {
  const showArrow = arrow ?? variant !== "filled";

  const base =
    "group inline-flex items-center gap-2 whitespace-nowrap text-[15px] font-normal leading-none " +
    "transition-[opacity,background-color,color] duration-200 ease-out focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

  const inkRing = "focus-visible:ring-ink/40 focus-visible:ring-offset-paper";
  const paperRing = "focus-visible:ring-paper/50 focus-visible:ring-offset-char";

  let shape: string;
  if (variant === "ghost") {
    shape =
      tone === "ink"
        ? `text-ink hover:opacity-60 ${inkRing}`
        : `text-paper hover:opacity-70 ${paperRing}`;
  } else if (variant === "outline") {
    shape =
      tone === "ink"
        ? `rounded-[80px] border border-ink px-5 py-3 text-ink hover:bg-ink hover:text-paper ${inkRing}`
        : `rounded-[80px] border border-paper px-5 py-3 text-paper hover:bg-paper hover:text-ink ${paperRing}`;
  } else {
    shape = `rounded-[80px] bg-char px-5 py-3 font-medium text-paper hover:bg-iron ${inkRing}`;
  }

  const classes = `${base} ${shape} ${className}`;

  const content = (
    <>
      {children}
      {showArrow && (
        <ArrowRight
          size={16}
          weight="regular"
          aria-hidden
          className="transition-transform duration-200 ease-out group-hover:translate-x-0.5"
        />
      )}
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        className={classes}
        target={target}
        rel={rel}
        aria-label={rest["aria-label"]}
      >
        {content}
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
      {content}
    </button>
  );
}
