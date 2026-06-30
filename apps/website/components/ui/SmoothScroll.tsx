"use client";

import { ReactLenis } from "lenis/react";
import type { ReactNode } from "react";

/*
  Site-wide smooth scrolling — the Linear/Vercel "premium feel". Lenis smooths
  the wheel + programmatic scroll on desktop; on touch devices it leaves the
  native momentum scroll untouched (syncTouch defaults to off), so iOS Safari
  stays fast and natural. Pairs with the existing <Reveal> scroll-in effects.
*/
export default function SmoothScroll({ children }: { children: ReactNode }) {
  return (
    <ReactLenis root options={{ lerp: 0.1, smoothWheel: true }}>
      {children}
    </ReactLenis>
  );
}
