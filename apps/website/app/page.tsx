import { LanguageProvider } from "@/components/i18n/LanguageProvider";
import Intro from "@/components/ui/Intro";
import Hero from "@/components/sections/Hero";
import Demos from "@/components/sections/Demos";
import Audience from "@/components/sections/Audience";
import Process from "@/components/sections/Process";
import Contact from "@/components/sections/Contact";

export default function Home() {
  return (
    <LanguageProvider>
      <Intro />
      <main className="flex-1">
        <Hero />
        <Audience />
        <Demos />
        <Process />
        <Contact />
      </main>
    </LanguageProvider>
  );
}
