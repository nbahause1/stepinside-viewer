import type { Metadata } from "next";
import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import About from "@/components/sections/About";

export const metadata: Metadata = {
  title: "Über uns",
  description:
    "Die Geschichte hinter StepInside: Hospitality und Immobilien, verbunden zu begehbaren 3D-Touren.",
};

export default function UeberUnsPage() {
  return (
    <LanguageProvider>
      <Nav />
      <main className="flex-1">
        <About />
      </main>
      <Footer />
    </LanguageProvider>
  );
}
