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
  Subtle scroll-into-view reveal (fade + small rise). Motivated motion only:
  it sequences content as it enters the viewport. Collapses to static instantly
  under prefers-reduced-motion.
*/
export default function Reveal({
  children,
  delay = 0,
  y = 16,
  className = "",
  as = "div",
}: RevealProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];

  return (
    <MotionTag
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </MotionTag>
  );
}
