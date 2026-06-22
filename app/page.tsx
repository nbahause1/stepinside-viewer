import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/sections/Hero";
import Demos from "@/components/sections/Demos";
import Audience from "@/components/sections/Audience";
import Process from "@/components/sections/Process";
import Contact from "@/components/sections/Contact";

export default function Home() {
  return (
    <LanguageProvider>
      <Nav />
      <main className="flex-1">
        <Hero />
        <Audience />
        <Demos />
        <Process />
        <Contact />
      </main>
      <Footer />
    </LanguageProvider>
  );
}
