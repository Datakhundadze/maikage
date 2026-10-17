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
  easeToward,
  keysToStick,
  mergeSticks,
  normDeg,
  pickLink,
  stepFromStick,
  TOUR_KEYS,
  turnRateFromStick,
  type StepLatch,
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
//     pushing forward past 60 % steps to the linked node closest to the view
//     direction (within ±50°), pulling back to the one behind — one step per
//     push (tourMath.ts).
//   drag anywhere else: look around (PSV); wheel / pinch: zoom.
//   floor chevrons: tap to step to that neighbour.
// STEP: turn toward the link (~300 ms), then zoom in while the next photo
// cross-fades in (~600 ms), arriving facing the direction of travel; then the
// zoom eases back. Every photo is turned by its northOffset (sphereCorrection),
// so a world yaw means the same direction everywhere and the view yaw simply
// carries over. Reduced motion: a plain fade. The old photo stays on screen
// until the next one is loaded, so there are no black frames; neighbours are
// preloaded once the current photo is shown (plugin `preload`).
// LAYERS: the wrapper is `isolate`, so everything sits below the sitewide
// chat launcher (z-50); nothing is placed in the bottom-right corner.

const DEG = Math.PI / 180;
const SOUND_KEY = "maika.showroom.sound";
const MIN_FOV = 30;
const MAX_FOV = 100;
/** Aim for this horizontal field of view; the vertical one is capped at MAX_FOV. */
const TARGET_HFOV = 100;
const ROTATE_MS = 300;
const FADE_MS = 600;
const REDUCED_FADE_MS = 450;
const ZOOM_BACK_MS = 260;
/** Zoom levels added during the cross-fade (the "step forward"). */
const STEP_ZOOM = 14;
/** View pitch while stepping (slightly down, like looking where you walk). */
const TRAVEL_PITCH_DEG = -4;

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
              transitionOptions: { showLoader: false, effect: "fade", speed: FADE_MS, rotation: false },
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

    const playSteps = () => {
      const f = footstepsRef.current;
      if (!soundOnRef.current || !f) return;
      f.play("left", 0.8);
      window.setTimeout(() => f.play("right", 0.75), reduceMotion ? 180 : 240);
    };

    let noWayTimer = 0;
    const showNoWay = () => {
      setNoWayHint(true);
      window.clearTimeout(noWayTimer);
      noWayTimer = window.setTimeout(() => setNoWayHint(false), 1600);
    };

    const goTo = async (link: TourLink) => {
      if (busy || disposed) return;
      busy = true;
      publish();
      setHintVisible(false);
      playSteps();
      const yaw = link.yawDeg * DEG;
      const pitch = TRAVEL_PITCH_DEG * DEG;
      const baseZoom = viewer.getZoomLevel();
      try {
        if (!reduceMotion) await viewer.animate({ yaw, pitch, speed: ROTATE_MS });
        const fromLink = tour.getCurrentNode().links?.find((l) => l.nodeId === link.to);
        await tour.setCurrentNode(
          link.to,
          {
            showLoader: false,
            effect: "fade",
            rotation: false,
            speed: reduceMotion ? REDUCED_FADE_MS : FADE_MS,
            rotateTo: { yaw, pitch },
            zoomTo: reduceMotion ? baseZoom : Math.min(100, baseZoom + STEP_ZOOM),
          },
          fromLink,
        );
        if (!disposed && !reduceMotion) await viewer.animate({ zoom: baseZoom, speed: ZOOM_BACK_MS });
      } catch {
        // aborted (another step, unmount) — the plugin keeps a consistent node
      } finally {
        busy = false;
        publish();
      }
    };

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
    let latch: StepLatch = { armed: true };
    let turnRate = 0;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;
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
      const r = stepFromStick(stick.y, latch);
      latch = r.latch;
      if (r.intent) {
        const link = pickLink(getNode(nodeId).links, viewYawDeg(), r.intent);
        if (link) void goTo(link);
        else showNoWay();
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
      if (link) void goTo(link);
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
    <div className="tour-viewer relative isolate h-full w-full overflow-hidden overscroll-none bg-[#101010]">
      <div ref={hostRef} className="absolute inset-0 touch-none" />

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
            ? "ჯოისტიკი: მარცხნივ/მარჯვნივ — მობრუნება, წინ — შემდეგ წერტილზე. თითით გადაათრიეთ — მიმოხედვა."
            : "←/→ ან A/D — მობრუნება, ↑/↓ ან W/S — წინ/უკან. მაუსით გადაათრიეთ — მიმოხედვა, ისრებზე დაჭერით — გადასვლა."}
        </p>
      )}

      {noWayHint && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-2 text-xs text-white"
          style={{ top: 64 }}
        >
          აქეთ გასასვლელი არ არის — მოტრიალდით ისრისკენ
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
