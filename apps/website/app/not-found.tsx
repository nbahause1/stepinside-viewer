import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Seite nicht gefunden",
  robots: { index: false, follow: true },
};

// Branded 404 in the site's paper/ink look, so a mistyped or stale URL still
// feels like innsyn and offers a clear way back.
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-paper px-6 text-center text-ink">
      <Link
        href="/"
        aria-label="innsyn"
        className="mb-10 inline-flex items-center gap-2.5"
      >
        <span aria-hidden className="block size-2 rotate-45 bg-ink" />
        <span className="text-[16px] font-bold tracking-[0.01em]">
          innsyn
        </span>
      </Link>

      <p className="text-[13px] font-medium uppercase tracking-[0.2em] text-smoke">
        Fehler 404
      </p>
      <h1 className="mt-4 max-w-[16ch] text-[clamp(2rem,6vw,3.5rem)] font-light leading-[1.05] tracking-[-0.025em]">
        Diese Seite gibt es nicht.
      </h1>
      <p className="mt-5 max-w-[44ch] text-[16px] leading-[1.5] text-pewter">
        Vielleicht wurde sie verschoben oder die Adresse hat sich vertippt.
      </p>

      <Link
        href="/"
        className="mt-9 inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-paper transition-opacity hover:opacity-80"
      >
        Zurück zur Startseite
      </Link>
    </div>
  );
}
