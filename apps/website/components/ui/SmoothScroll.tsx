"use client";

import { ReactLenis } from "lenis/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

/*
  Site-wide smooth scrolling — the Linear/Vercel "premium feel". Lenis smooths
  the wheel + programmatic scroll on desktop; on touch devices it leaves the
  native momentum scroll untouched (syncTouch defaults to off), so iOS Safari
  stays fast and natural. Pairs with the existing <Reveal> scroll-in effects.

  Respects prefers-reduced-motion: when the visitor asked for reduced motion we
  skip Lenis entirely and fall back to the browser's native scroll. (Lenis owns
  smooth scrolling now, so the CSS `scroll-behavior: smooth` was removed from
  globals.css to avoid the two fighting over the same scroll.)
*/
export default function SmoothScroll({ children }: { children: ReactNode }) {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (reduce) return <>{children}</>;

  return (
    <ReactLenis root options={{ lerp: 0.1, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}
