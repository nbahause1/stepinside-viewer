"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Seconds of delay, useful for staggering siblings. */
  delay?: number;
  /** Initial vertical offset in px. */
  y?: number;
  className?: string;
  as?: "div" | "li" | "section";
}

/*
  Subtle scroll-into-view reveal: fade + small rise + a soft blur that sharpens
  as the block enters the viewport (the Linear/Vercel "focus-in" feel). Motivated
  motion only — it sequences content as it appears. Collapses to static instantly
  under prefers-reduced-motion (no blur, no offset).
*/
export default function Reveal({
  children,
  delay = 0,
  y = 10,
  className = "",
  as = "div",
}: RevealProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];

  return (
    <MotionTag
      className={className}
      initial={reduce ? false : { opacity: 0, y, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}
