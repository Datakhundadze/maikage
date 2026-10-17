import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin, type MarkerConfig } from "@photo-sphere-viewer/markers-plugin";
import { VirtualTourPlugin, type VirtualTourNode } from "@photo-sphere-viewer/virtual-tour-plugin";
// Styles come in as strings and are injected while the viewer is mounted: a
// CSS file in this lazy chunk would add an entry to the main bundle's preload
// map.
import psvCoreCss from "@photo-sphere-viewer/core/index.css?inline";
import psvMarkersCss from "@photo-sphere-viewer/markers-plugin/index.css?inline";
import psvTourCss from "@photo-sphere-viewer/virtual-tour-plugin/index.css?inline";
import tourCss from "./tour.css?inline";
import Joystick from "./Joystick";
import TuneOverlay, { type TunePose } from "./TuneOverlay";
import { getNode, panoramaSize, TOUR, TOUR_NODES, type TourLink, type TourNode, type TourNodeId } from "@/lib/tour/tourConfig";
import {
  angleDiff,
  autoTurnMs,
  bobAt,
  easeToward,
  FOOTFALLS,
  keysToStick,
  mergeSticks,
  normDeg,
  pickLink,
  TOUR_KEYS,
  turnRateFromStick,
  walkIntent,
  type StepIntent,
  type StickAxes,
} from "@/lib/tour/tourMath";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";

// The /showroom 360° photo tour: six panoramas along the shop aisle
// (tourConfig.ts), shown with Photo Sphere Viewer. PSV and its plugins are
// imported only here, and this file only from the lazy ShowroomPage, so none
// of it reaches the main bundle.
//
// CONTROLS
//   joystick (bottom-left) / ←→↑↓ / WASD: x turns (≤ 90°/s, 12 % dead zone);
//     held forward past 50 % the visitor keeps walking: each step goes to the
//     linked node closest to the view (within ±100°), turning toward it
//     first if needed; held back walks backward the same way (tourMath.ts).
//   drag anywhere else: look around (PSV); wheel / pinch: zoom.
//   floor chevrons: tap to walk to that neighbour.
// STEP (TOUR.walk in tourConfig.ts): turn toward the link if it is off to the
// side, push into the current photo (first stride), then freeze that frame on
// a 2D canvas on top, switch the next photo in underneath and let the frozen
// frame keep growing while it fades — so the picture moves forward the whole
// time instead of zooming in and back out. A head bob with two footfalls (and
// the footstep sound, if on) runs over the whole step; the step lands facing
// the direction of travel. Every photo is turned by its northOffset
// (sphereCorrection), so a world yaw means the same direction everywhere. The
// frozen frame stays until the next photo is loaded, so there are no black
// frames; neighbours are preloaded once a photo is shown (plugin `preload`).
// Reduced motion: a plain cross-fade, no bob.
// LAYERS: the wrapper is `isolate`, so everything sits below the sitewide
// chat launcher (z-50); nothing is placed in the bottom-right corner.

const DEG = Math.PI / 180;
const SOUND_KEY = "maika.showroom.sound";
const MIN_FOV = 30;
const MAX_FOV = 100;
/** Aim for this horizontal field of view; the vertical one is capped at MAX_FOV. */
const TARGET_HFOV = 100;
const WALK = TOUR.walk;
const clampZoom = (z: number) => Math.min(100, Math.max(0, z));
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

type Status = "loading" | "ready" | "error" | "nowebgl";

declare global {
  interface Window {
    /** Read-only state for browser checks. */
    __tour?: {
      node: TourNodeId;
      yawDeg: number;
      pitchDeg: number;
      busy: boolean;
      steps: number;
      links: { to: TourNodeId; yawDeg: number }[];
    };
  }
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function media(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function writeSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // private mode / storage blocked: the toggle still works for this visit
  }
}

/** Zoom level giving ~TARGET_HFOV across, for this container shape. */
function defaultZoomFor(width: number, height: number): number {
  const aspect = width > 0 && height > 0 ? width / height : 1.5;
  const vfov = (2 * Math.atan(Math.tan((TARGET_HFOV / 2) * DEG) / aspect)) / DEG;
  const clamped = Math.min(MAX_FOV, Math.max(MIN_FOV, vfov));
  return ((MAX_FOV - clamped) / (MAX_FOV - MIN_FOV)) * 100;
}

/** Corners of a square on the floor around the nadir that holds a disc `widthDeg` across. */
function nadirCorners(widthDeg: number) {
  const r = Math.tan((widthDeg / 2) * DEG); // disc radius at unit distance below the camera
  const pitch = -(Math.PI / 2 - Math.atan(r * Math.SQRT2));
  // top edge of the image toward world yaw 0
  return [-45, 45, 135, -135].map((yaw) => ({ yaw: yaw * DEG, pitch }));
}

function chevronElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "tour-chevron";
  el.innerHTML =
    '<svg viewBox="0 0 120 75" aria-hidden="true">' +
    '<path d="M14 66 L60 18 L106 66" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 4)"/>' +
    '<path d="M14 66 L60 18 L106 66" fill="none" stroke="#fff" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg>";
  return el;
}

function tourNodes(size: "4k" | "6k"): VirtualTourNode[] {
  const nadir: MarkerConfig = {
    id: "nadir-logo",
    imageLayer: TOUR.nadirLogo.url,
    position: nadirCorners(TOUR.nadirLogo.widthDeg) as MarkerConfig["position"],
  };
  return TOUR_NODES.map((n: TourNode) => ({
    id: n.id,
    name: n.label,
    panorama: n.panorama[size],
    // PSV shows photo yaw (viewer yaw + pan) at viewer yaw: pan = northOffset
    // puts photo yaw `northOffsetDeg` at world (viewer) yaw 0
    sphereCorrection: { pan: n.northOffsetDeg * DEG },
    links: n.links.map((l) => ({ nodeId: l.to, position: { yaw: l.yawDeg * DEG, pitch: l.pitchDeg * DEG }, data: l })),
    markers: [
      nadir,
      ...n.links.map(
        (l): MarkerConfig => ({
          id: `link-${l.to}`,
          elementLayer: chevronElement(),
          position: { yaw: l.yawDeg * DEG, pitch: l.pitchDeg * DEG },
          // lie flat on the floor, pointing away from the camera
          rotation: { pitch: "90deg" },
          data: { link: l },
        }),
      ),
    ],
  }));
}

export default function TourViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const stickRef = useRef<StickAxes>({ x: 0, y: 0 });
  const footstepsRef = useRef<Footsteps | null>(null);
  const soundOnRef = useRef(false);
  const [status, setStatus] = useState<Status>(() => (hasWebGL() ? "loading" : "nowebgl"));
  const [progress, setProgress] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [noWayHint, setNoWayHint] = useState(false);
  const [touch] = useState(() => media("(pointer: coarse)"));
  const [tune] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("tune") === "1";
    } catch {
      return false;
    }
  });
  const [pose, setPose] = useState<TunePose | null>(null);

  // sound: off by default; the AudioContext is created from a user gesture
  const ensureFootsteps = useCallback(() => {
    if (!footstepsRef.current) footstepsRef.current = createFootsteps({ volume: 0.22, pitchHz: 62, pitchSpread: 0.08 });
    void footstepsRef.current?.resume();
  }, []);
  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    writeSoundPref(next);
    if (next) ensureFootsteps();
    else void footstepsRef.current?.suspend();
  }, [ensureFootsteps]);

  useEffect(() => {
    if (status === "nowebgl") return;
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    const reduceMotion = media("(prefers-reduced-motion: reduce)");
    const size = panoramaSize({ coarsePointer: media("(pointer: coarse)"), viewportWidth: window.innerWidth });

    const style = document.createElement("style");
    style.dataset.tour = "";
    style.textContent = [psvCoreCss, psvMarkersCss, psvTourCss, tourCss].join("\n");
    document.head.appendChild(style);

    let viewer: Viewer;
    try {
      viewer = new Viewer({
        container: host,
        navbar: false,
        loadingImg: null,
        loadingTxt: "",
        defaultYaw: TOUR.startYawDeg * DEG,
        defaultPitch: TOUR.startPitchDeg * DEG,
        minFov: MIN_FOV,
        maxFov: MAX_FOV,
        defaultZoomLvl: defaultZoomFor(host.clientWidth, host.clientHeight),
        keyboard: false,
        // keep the last frame readable so a step can freeze it on a 2D canvas
        rendererParameters: { alpha: true, antialias: true, preserveDrawingBuffer: true },
        mousewheelCtrlKey: false,
        touchmoveTwoFingers: false,
        moveInertia: true,
        lang: { loadError: "ფოტო ვერ ჩაიტვირთა" },
        plugins: [
          [MarkersPlugin, {}],
          [
            VirtualTourPlugin,
            {
              positionMode: "manual",
              renderMode: "2d",
              nodes: tourNodes(size),
              startNodeId: TOUR.startNodeId,
              preload: true,
              showLinkTooltip: false,
              transitionOptions: { showLoader: false, effect: "fade", speed: WALK.reducedFadeMs, rotation: false },
            },
          ],
        ],
      });
    } catch {
      style.remove();
      setStatus("nowebgl");
      return;
    }
    viewerRef.current = viewer;
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);

    let busy = false;
    let steps = 0;
    let nodeId: TourNodeId = TOUR.startNodeId;
    const viewYawDeg = () => normDeg(viewer.getPosition().yaw / DEG);
    const viewPitchDeg = () => viewer.getPosition().pitch / DEG;
    const publish = () => {
      window.__tour = {
        node: nodeId,
        yawDeg: viewYawDeg(),
        pitchDeg: viewPitchDeg(),
        busy,
        steps,
        links: getNode(nodeId).links.map((l) => ({ to: l.to, yawDeg: l.yawDeg })),
      };
    };

    const timers = new Set<number>();
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };
    const footfall = (i: number) => {
      const f = footstepsRef.current;
      if (soundOnRef.current && f) f.play(i % 2 === 0 ? "left" : "right", i % 2 === 0 ? 0.8 : 0.72);
    };

    let noWayTimer = 0;
    const showNoWay = () => {
      setNoWayHint(true);
      window.clearTimeout(noWayTimer);
      noWayTimer = window.setTimeout(() => setNoWayHint(false), 1600);
    };

    // ── head bob: a CSS transform on the stage (viewer + frozen frame) ──────
    let bobStart = 0;
    let bobMs = 0;
    const applyBob = (now: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      if (!bobMs) {
        if (stage.style.transform) stage.style.transform = "";
        return;
      }
      const t = (now - bobStart) / bobMs;
      if (t >= 1) {
        bobMs = 0;
        stage.style.transform = "";
        return;
      }
      const b = bobAt(t, WALK);
      stage.style.transform = `translateY(${b.dyPx.toFixed(2)}px) rotate(${b.rollDeg.toFixed(3)}deg) scale(${b.scale.toFixed(4)})`;
    };

    // ── the frozen frame: last picture of the old photo, on a 2D canvas ─────
    const freezeFrame = (): boolean => {
      const out = frozenRef.current;
      const src = host.querySelector("canvas");
      if (!out || !src || !src.width || !src.height) return false;
      try {
        out.width = src.width;
        out.height = src.height;
        const ctx = out.getContext("2d");
        if (!ctx) return false;
        ctx.drawImage(src, 0, 0);
      } catch {
        return false;
      }
      out.style.transition = "none";
      out.style.opacity = "1";
      out.style.transform = "scale(1)";
      out.style.visibility = "visible";
      return true;
    };
    const releaseFrame = (scaleTo: number) => {
      const out = frozenRef.current;
      if (!out) return;
      // next frame, so the "from" state above is committed before the transition
      requestAnimationFrame(() => {
        out.style.transition = `opacity ${WALK.blendMs}ms cubic-bezier(.3,.6,.4,1), transform ${WALK.blendMs}ms cubic-bezier(.2,.5,.4,1)`;
        out.style.opacity = "0";
        out.style.transform = `scale(${scaleTo})`;
      });
      later(() => {
        out.style.visibility = "hidden";
        out.style.transition = "none";
      }, WALK.blendMs + 40);
    };
    const setWalking = (on: boolean) => rootRef.current?.classList.toggle("tour-walking", on);

    const step = async (link: TourLink, intent: StepIntent) => {
      if (busy || disposed) return;
      busy = true;
      publish();
      setHintVisible(false);
      setNoWayHint(false);
      const fromLink = tour.getCurrentNode().links?.find((l) => l.nodeId === link.to);
      const baseZoom = viewer.getZoomLevel();
      const pitch = WALK.travelPitchDeg * DEG;
      // forward: arrive facing the way we walked. back: arrive facing away from
      // the way we moved (as if stepping backward), so along a bending aisle the
      // next backward step keeps going the same way instead of bouncing.
      const arriveYaw = (intent === "forward" ? link.yawDeg : normDeg(link.yawDeg + 180)) * DEG;
      try {
        if (reduceMotion) {
          await tour.setCurrentNode(
            link.to,
            { showLoader: false, effect: "fade", rotation: false, speed: WALK.reducedFadeMs, rotateTo: { yaw: arriveYaw, pitch }, zoomTo: baseZoom },
            fromLink,
          );
          footfall(0);
          return;
        }
        setWalking(true);
        // 1. face the link (forward steps only)
        if (intent === "forward") {
          const turnMs = autoTurnMs(angleDiff(link.yawDeg, viewYawDeg()));
          if (turnMs > 0) await viewer.animate({ yaw: arriveYaw, pitch, speed: turnMs, easing: "inOutSine" });
        }
        if (disposed) return;
        // 2. first stride into the current photo; bob + footfalls over the whole step
        const stepMs = WALK.outMs + WALK.blendMs;
        bobStart = performance.now();
        bobMs = stepMs;
        FOOTFALLS.forEach((f, i) => later(() => footfall(i), f * stepMs));
        const outZoom = clampZoom(baseZoom + (intent === "forward" ? WALK.outZoom : WALK.backOutZoom));
        await viewer.animate({ zoom: outZoom, pitch, speed: WALK.outMs, easing: "inQuad" });
        if (disposed) return;
        // 3. freeze it, switch the next photo in underneath, blend forward
        const frozen = freezeFrame();
        const inZoom = clampZoom(baseZoom + (intent === "forward" ? WALK.inFromZoom : WALK.backInFromZoom));
        await tour.setCurrentNode(
          link.to,
          frozen
            ? { showLoader: false, effect: "none", rotation: false, rotateTo: { yaw: arriveYaw, pitch }, zoomTo: inZoom }
            : { showLoader: false, effect: "fade", rotation: false, speed: WALK.blendMs, rotateTo: { yaw: arriveYaw, pitch }, zoomTo: inZoom },
          fromLink,
        );
        if (disposed) return;
        // if the photo took a while to load, the bob has run out: restart a short settle
        if (performance.now() - bobStart > stepMs) {
          bobStart = performance.now() - WALK.outMs;
          bobMs = stepMs;
        }
        if (frozen) releaseFrame(intent === "forward" ? WALK.overlayScaleTo : WALK.backOverlayScaleTo);
        await viewer.animate({ zoom: baseZoom, speed: WALK.blendMs, easing: "outQuad" });
      } catch {
        // aborted (unmount) — the plugin keeps a consistent node
        const out = frozenRef.current;
        if (out) out.style.visibility = "hidden";
      } finally {
        setWalking(false);
        busy = false;
        publish();
      }
    };

    /** The link a push goes to, or null (shows the hint). */
    const linkFor = (intent: StepIntent) => pickLink(getNode(nodeId).links, viewYawDeg(), intent);

    // ── input: joystick + keys → turning and steps ─────────────────────────
    const keys = new Set<string>();
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (!TOUR_KEYS.has(e.code) || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      e.preventDefault();
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    let ready = false; // first photo shown
    let turnRate = 0;
    let deadEndShown = false; // the hint once per push, not every frame
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
      applyBob(now);
      if (!ready) return;
      const stick = mergeSticks(stickRef.current, keysToStick(keys));
      if (busy) {
        turnRate = 0;
        return;
      }
      turnRate = easeToward(turnRate, turnRateFromStick(stick.x), dt);
      if (Math.abs(turnRate) > 0.05) {
        const p = viewer.getPosition();
        viewer.rotate({ yaw: p.yaw + turnRate * DEG * (dt / 1000), pitch: p.pitch });
        setHintVisible(false);
      } else turnRate = 0;
      // held forward / back: keep walking, one step after another
      const intent = walkIntent(stick.y);
      if (!intent) {
        deadEndShown = false;
        return;
      }
      const link = linkFor(intent);
      if (link) void step(link, intent);
      else if (!deadEndShown) {
        deadEndShown = true;
        showNoWay();
      }
    };
    raf = requestAnimationFrame(loop);

    // ── viewer events ──────────────────────────────────────────────────────
    viewer.addEventListener("load-progress", ({ progress: p }) => {
      if (!ready) setProgress(Math.round(p));
    });
    viewer.addEventListener("panorama-error", () => {
      if (!ready) setStatus("error");
    });
    let poseRaf = 0;
    const onPosition = () => {
      publish();
      if (!tune || poseRaf) return;
      poseRaf = requestAnimationFrame(() => {
        poseRaf = 0;
        let photoYawDeg: number | null = null;
        try {
          const t = viewer.dataHelper.sphericalCoordsToTextureCoords(viewer.getPosition());
          const w = (t as { textureX: number }).textureX;
          const width = viewer.state.textureData?.panoData?.fullWidth;
          if (width) photoYawDeg = normDeg((w / width) * 360 - 180);
        } catch {
          photoYawDeg = null;
        }
        setPose({ node: nodeId, yawDeg: viewYawDeg(), pitchDeg: viewPitchDeg(), photoYawDeg });
      });
    };
    viewer.addEventListener("position-updated", onPosition);
    tour.addEventListener("node-changed", ({ node }) => {
      nodeId = node.id as TourNodeId;
      if (!ready) {
        ready = true;
        setStatus("ready");
        setProgress(100);
      } else {
        steps++;
      }
      onPosition();
    });
    markers.addEventListener("select-marker", ({ marker }) => {
      const link = (marker.data as { link?: TourLink } | undefined)?.link;
      if (link) void step(link, "forward");
    });

    // a remembered "sound on" needs a gesture before audio may start
    const onFirstGesture = () => {
      if (soundOnRef.current) ensureFootsteps();
    };
    if (readSoundPref()) {
      soundOnRef.current = true;
      setSoundOn(true);
      window.addEventListener("pointerdown", onFirstGesture, { once: true });
      window.addEventListener("keydown", onFirstGesture, { once: true });
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(poseRaf);
      window.clearTimeout(noWayTimer);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      delete window.__tour;
      viewerRef.current = null;
      viewer.destroy();
      style.remove();
      void footstepsRef.current?.close();
      footstepsRef.current = null;
    };
    // set up once; `status` is read only to skip setup without WebGL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "nowebgl") {
    return (
      <div className="relative isolate h-full w-full overflow-hidden bg-[#101010]">
        <img
          src={getNode(TOUR.startNodeId).panorama["4k"]}
          alt="Maika.ge-ს შოურუმი შესასვლელიდან"
          className="h-full w-full object-cover"
          style={{ objectPosition: "50% 55%" }}
        />
        <p className="absolute left-4 right-4 top-4 mx-auto max-w-md rounded-lg bg-black/55 px-4 py-3 text-center text-sm text-white">
          თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს (საჭიროა WebGL). ქვემოთ — შოურუმის ფოტო შესასვლელიდან; სცადეთ სხვა ბრაუზერი ან
          განაახლეთ არსებული.
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="tour-viewer relative isolate h-full w-full overflow-hidden overscroll-none bg-[#101010]">
      {/* stage = viewer + frozen frame; the head bob moves both together */}
      <div ref={stageRef} className="absolute inset-0" style={{ willChange: "transform" }}>
        <div ref={hostRef} className="absolute inset-0 touch-none" />
        <canvas
          ref={frozenRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ visibility: "hidden", transformOrigin: "50% 50%" }}
        />
      </div>

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101010] text-white">
          <p className="text-sm font-medium" aria-live="polite">
            შოურუმი იტვირთება… {progress}%
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${Math.max(5, progress)}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101010]/90 p-6 text-center text-sm text-white">
          <p>შოურუმის ფოტო ვერ ჩაიტვირთა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.</p>
        </div>
      )}

      {status === "ready" && hintVisible && !tune && (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[16rem] rounded-lg bg-black/55 px-3 py-2 text-xs leading-snug text-white">
          {touch
            ? "ჯოისტიკი წინ გეჭიროთ — იარეთ, მარცხნივ/მარჯვნივ — მობრუნება. თითით გადაათრიეთ — მიმოხედვა."
            : "↑/W დაჭერილი — სიარული, ←/→ ან A/D — მობრუნება, ↓/S — უკან. მაუსით გადაათრიეთ — მიმოხედვა."}
        </p>
      )}

      {noWayHint && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-2 text-xs text-white"
          style={{ top: 64 }}
        >
          აქ გზა მთავრდება — მოტრიალდით
        </p>
      )}

      {status === "ready" && (
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? "ხმის გამორთვა" : "ხმის ჩართვა"}
          className="absolute right-3 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          {soundOn ? <Volume2 className="h-5 w-5" aria-hidden /> : <VolumeX className="h-5 w-5" aria-hidden />}
        </button>
      )}

      {status === "ready" && (
        <Joystick
          onChange={(axes) => {
            stickRef.current = axes;
          }}
        />
      )}

      {tune && status === "ready" && (
        <TuneOverlay
          pose={pose}
          onPickNode={(id) => {
            const tour = viewerRef.current?.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
            void tour?.setCurrentNode(id, { showLoader: false, effect: "fade", speed: 300, rotation: false });
          }}
        />
      )}
    </div>
  );
}
