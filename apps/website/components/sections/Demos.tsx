"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowsOut, X } from "@phosphor-icons/react";
import { useLang } from "@/components/i18n/LanguageProvider";
import Reveal from "@/components/ui/Reveal";
import { config, SECTION_IDS } from "@/lib/config";

/*
  Demos: the walkable scan. The viewer is heavy (a continuously-rendering WebGL/
  WebGPU splat scene), so it is NOT embedded in the page flow — a live iframe
  there would render in the background and jank the whole page's scrolling. We
  show a static cover instead and only MOUNT the viewer when the visitor opens
  it ("Vollbild"). It then lives in a fixed full-viewport overlay; collapsing it
  hides the iframe (display:none → the browser throttles its rendering) but keeps
  it mounted, so re-opening is instant and the tour keeps its state.

  Arrival audio: a subtle two-part SFX. The "Vollbild" tap is the user gesture
  iOS requires, so the audio MUST originate here in the parent (the scan runs in
  a cross-document iframe that never receives its own gesture before loading).
  The viewer's boot splash bridges the load with a door-opening film behind
  its loader logo (first frame fades in as a still, then the film starts),
  posting 'stepinside:doorVideo' the moment playback begins — we play the door
  SFX (the film's own extracted soundtrack, so sound is picture-locked) on
  that cue, and film and audio open the door together over the loading screen. 'stepinside:doorVideoArmed' (sent as
  the viewer boots) cancels our click-anchored fallback, which otherwise plays
  the door over the loader as before (stale cached viewer, film missing).
  When the viewer posts that the scene is revealed, we play the intro sting —
  "you're standing in the room". Kept quiet (0.32) for a premium, unobtrusive
  feel.
*/
const SFX_VOLUME = 0.5;

export default function Demos() {
  const { t } = useLang();
  const [launched, setLaunched] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const doorRef = useRef<HTMLAudioElement | null>(null);
  const introRef = useRef<HTMLAudioElement | null>(null);
  const doorPlayingRef = useRef(false);
  const doorStartedRef = useRef(false); // real (audible) door play has begun
  const doorFallbackRef = useRef<number | null>(null);
  // Mirrors `expanded` for the long-lived message handler: the door cue can
  // arrive many seconds after the click (film starts once the scene is ready),
  // and it shouldn't sound if the visitor has collapsed back to the page.
  const expandedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Start the audible door SFX — normally cued by the viewer's doorVideo
  // message so the unlock sound lands exactly as the boot-splash door film
  // starts; also armed as a click-anchored timeout fallback (stale cached
  // viewer, video error). Idempotent: whichever fires first wins.
  const playDoor = () => {
    const door = doorRef.current;
    if (!door || doorStartedRef.current || !expandedRef.current) return;
    doorStartedRef.current = true;
    if (doorFallbackRef.current !== null) {
      window.clearTimeout(doorFallbackRef.current);
      doorFallbackRef.current = null;
    }
    door.muted = false;
    door.currentTime = 0;
    door.volume = SFX_VOLUME;
    doorPlayingRef.current = true;
    door.play().catch(() => {
      doorPlayingRef.current = false;
    });
  };

  // Tell the viewer when it's hidden (collapsed to the website) vs shown, so it
  // suspends/resumes its own audio — a mounted-but-hidden iframe keeps playing.
  useEffect(() => {
    expandedRef.current = expanded;
    if (!launched) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "stepinside:visibility", visible: expanded },
      "*",
    );
  }, [expanded, launched]);

  // Preload the SFX and listen for the viewer's "revealed" cue.
  useEffect(() => {
    // ?v bumped whenever the SFX files change, so the browser never plays a
    // stale cached clip while we iterate on the sounds.
    const door = new Audio("/sfx/door.mp3?v=4");
    const intro = new Audio("/sfx/intro.mp3?v=3");
    for (const a of [door, intro]) {
      a.preload = "auto";
      a.volume = SFX_VOLUME;
    }
    doorRef.current = door;
    introRef.current = intro;
    // Track the door's playback with our OWN flag, not door.paused/ended: on a
    // fast (cached) load the viewerReady message can arrive before the media
    // element has flipped paused→false, so the state read is racy. The 'ended'
    // event, by contrast, is reliable.
    door.addEventListener("ended", () => {
      doorPlayingRef.current = false;
    });

    // The viewer posts this once the scene is on screen (the loader now holds
    // the reveal until at least the door "unlock" length, so on a cached scan
    // the room appears AS the door finishes — not 1.5s into it). If the door is
    // somehow still going, defer the intro until it ends so they never overlap.
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      // The viewer will cue the door itself (when its film starts, right
      // before the reveal) — stand down the click-anchored fallback.
      if (e.data?.type === "stepinside:doorVideoArmed") {
        if (doorFallbackRef.current !== null) {
          window.clearTimeout(doorFallbackRef.current);
          doorFallbackRef.current = null;
        }
        return;
      }
      // The boot-splash door film just started — open the door audibly too.
      if (e.data?.type === "stepinside:doorVideo") {
        playDoor();
        return;
      }
      if (e.data?.type !== "stepinside:viewerReady") return;
      const playIntro = () => {
        intro.currentTime = 0;
        intro.muted = false;
        intro.volume = SFX_VOLUME;
        intro.play().catch(() => {});
      };
      if (doorPlayingRef.current) {
        let done = false;
        const go = () => {
          if (done) return;
          done = true;
          door.removeEventListener("ended", go);
          playIntro();
        };
        door.addEventListener("ended", go, { once: true });
        window.setTimeout(go, 3500); // fallback if 'ended' never fires
      } else {
        playIntro();
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (doorFallbackRef.current !== null) {
        window.clearTimeout(doorFallbackRef.current);
        doorFallbackRef.current = null;
      }
      door.pause();
      intro.pause();
    };
  }, []);

  const open = () => {
    // First launch only: this click is the gesture that unlocks audio on iOS.
    // Start the door now (over the loading screen) and prime the intro with a
    // silent real play so it can start later from the async viewerReady message.
    if (!launched) {
      const door = doorRef.current;
      const intro = introRef.current;
      if (door) {
        // Prime the door within the gesture (muted real play, same pattern as
        // the intro below) so the actual play can start later from the async
        // doorVideo message — in sync with the boot splash's door film.
        door.muted = true;
        door.volume = SFX_VOLUME;
        door
          .play()
          .then(() => {
            // If the doorVideo cue already started the real play, leave it be.
            if (doorStartedRef.current) return;
            door.pause();
            door.currentTime = 0;
            door.muted = false;
          })
          .catch(() => {
            door.muted = false;
          });
        // Fallback, anchored to the click: if the viewer never reports its
        // door film starting, play the unlock over the loader anyway.
        doorFallbackRef.current = window.setTimeout(playDoor, 2600);
      }
      if (intro) {
        // Prime the intro within the gesture so it can play later from the async
        // viewerReady message. MUTED, not volume=0: iOS freezes .volume, so a
        // volume=0 prime actually plays a blip of the intro at full volume during
        // loading — exactly the "intro over the door" the door bed should own.
        // muted IS honoured on iOS, so this warms/unlocks it silently; we unmute
        // before the real deferred play.
        intro.muted = true;
        intro.volume = SFX_VOLUME;
        intro
          .play()
          .then(() => {
            intro.pause();
            intro.currentTime = 0;
            intro.muted = false;
          })
          .catch(() => {
            intro.muted = false;
          });
      }
    }
    setLaunched(true);
    setExpanded(true);
  };

  // While fullscreen: lock the page behind it and let Esc close it.
  useEffect(() => {
    if (!expanded) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <section
      id={SECTION_IDS.demos}
      className="overflow-x-clip border-t border-ink/10 bg-paper"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 md:py-32">
        <Reveal className="text-center">
          <h2 className="text-[36px] font-light leading-[1.05] tracking-[-0.025em] text-ink md:text-[clamp(2.5rem,5vw,4rem)]">
            {t.demos.heading}
          </h2>
          <p className="mx-auto mt-5 max-w-[60ch] text-[17px] leading-[1.5] text-pewter">
            {t.demos.intro}
          </p>
        </Reveal>

        {/* Unlit cover in the page flow — no iframe here, so the heavy scan is
            never loaded or rendered while scrolling the page. The plate stays
            deliberately empty: the room is revealed on entry, not before. */}
        <div
          id={SECTION_IDS.gate}
          className="relative mx-auto mt-12 aspect-[3/4] w-full max-w-[1100px] scroll-mt-20 overflow-hidden rounded-[12px] border border-ink/10 bg-ink shadow-[0_24px_70px_-30px_rgba(0,0,0,0.5)] sm:aspect-[4/3] md:aspect-video"
        >
          <button
            type="button"
            onClick={open}
            aria-label={t.demos.fullscreen}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-6 text-center"
          >
            <span className="inline-flex items-center gap-2.5 rounded-full bg-paper/10 py-3.5 pl-5 pr-6 text-[15px] font-medium text-paper ring-1 ring-paper/25 backdrop-blur-md transition-colors hover:bg-paper/20">
              <ArrowsOut size={20} weight="bold" aria-hidden />
              {t.demos.fullscreen}
            </span>
            <span className="max-w-[30ch] text-[14px] font-medium leading-[1.4] text-paper/80">
              {t.demos.fullscreenHint}
            </span>
          </button>
        </div>
      </div>

      {/* The viewer mounts only after the first launch. Fixed full-viewport when
          open; display:none when closed (rendering throttled, no page jank) but
          kept mounted for an instant, state-preserving re-open. Rendered outside
          any transformed/filtered ancestor so position:fixed covers the viewport. */}
      {launched && (
        <div className={expanded ? "fixed inset-0 z-[100] bg-ink" : "hidden"}>
          <iframe
            ref={iframeRef}
            src={config.viewerEmbedUrl}
            title={t.demos.heading}
            allow="fullscreen; xr-spatial-tracking; accelerometer; gyroscope"
            className="absolute inset-0 h-full w-full border-0"
          />
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label={t.demos.exitFullscreen}
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-ink/55 text-paper backdrop-blur-md transition-colors hover:bg-ink/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper/60"
          >
            <X size={20} weight="bold" aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
