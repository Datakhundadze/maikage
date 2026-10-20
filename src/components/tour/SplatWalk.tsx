import { useCallback, useEffect, useRef, useState } from "react";
import { Gamepad2, Maximize2, Minimize2, MoveVertical, Volume2, VolumeX } from "lucide-react";
import { PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import Joystick from "./Joystick";
import DPad from "./DPad";
import { keysToStick, mergeSticks, normDeg, TOUR_KEYS, type StickAxes } from "@/lib/tour/tourMath";
import { forwardOf, moveWithCollision, nearestFree, SPLAT_FEEL, SPLAT_WALK, stickAxis } from "@/lib/tour/splatWalk";
import { SHOP_WALK_GRID } from "@/lib/tour/splatWalkGrid";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";

// /showroom/3d — TEST: walk anywhere in the shop, a Gaussian splat scanned
// with Scaniverse from a 360° walk (Spark renders it on three.js). Same
// controls as the video walk: joystick or arrows (remembered), keys, drag to
// look. Collisions come from a floor grid made from the splat
// (lib/tour/splatWalkGrid.ts) so racks and walls can't be walked through.
// The splat (~28 MB) streams from Supabase Storage with a real percentage.

const SOUND_KEY = "maika.showroom.sound";
const CONTROLS_KEY = "maika.showroom.controls";
type Controls = "joystick" | "arrows";
type Status = "loading" | "ready" | "error" | "nowebgl";

declare global {
  interface Window {
    /** Read-only state for browser checks. */
    __splat?: {
      ready: boolean;
      x: number;
      z: number;
      yawDeg: number;
      pitchDeg: number;
      walked: number;
      fps: number;
      pixelRatio: number;
    };
  }
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: holds for this visit only
  }
}

/** Download with a percentage (Content-Length, or the known size when the server omits it). */
async function fetchWithProgress(url: string, onPct: (pct: number) => void, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length")) || SPLAT_WALK.approxBytes;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onPct(Math.min(99, Math.round((got / total) * 100)));
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export default function SplatWalk() {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<StickAxes>({ x: 0, y: 0 });
  const footstepsRef = useRef<Footsteps | null>(null);
  const soundOnRef = useRef(readPref(SOUND_KEY) !== "off");
  const [status, setStatus] = useState<Status>(() => (hasWebGL2() ? "loading" : "nowebgl"));
  const [pct, setPct] = useState(0);
  const [errDetail, setErrDetail] = useState("");
  const [soundOn, setSoundOn] = useState(soundOnRef.current);
  const [hintVisible, setHintVisible] = useState(true);
  const [touch] = useState(() => {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch {
      return false;
    }
  });
  const [controls, setControls] = useState<Controls>(() => (readPref(CONTROLS_KEY) === "arrows" ? "arrows" : "joystick"));
  const switchControls = useCallback(() => {
    setControls((c) => {
      const next: Controls = c === "joystick" ? "arrows" : "joystick";
      writePref(CONTROLS_KEY, next);
      return next;
    });
    stickRef.current = { x: 0, y: 0 };
  }, []);

  // sound: footsteps only, after the visitor's first tap / key press
  const ensureAudio = useCallback(() => {
    if (!footstepsRef.current) footstepsRef.current = createFootsteps({ volume: 0.3, pitchHz: 70, pitchSpread: 0.08 });
    void footstepsRef.current?.resume();
  }, []);
  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    writePref(SOUND_KEY, next ? "on" : "off");
    if (next) ensureAudio();
    else void footstepsRef.current?.suspend();
  }, [ensureAudio]);

  // full screen, or cover the window where the API is missing (iPhone)
  const [fullscreen, setFullscreen] = useState(false);
  const [covering, setCovering] = useState(false);
  useEffect(() => {
    const onChange = () => {
      const d = document as Document & { webkitFullscreenElement?: Element | null };
      setFullscreen(!!(document.fullscreenElement || d.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const d = document as Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
    if (covering) return setCovering(false);
    if (document.fullscreenElement || d.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else d.webkitExitFullscreen?.();
      return;
    }
    try {
      if (el?.requestFullscreen) {
        void el.requestFullscreen().catch(() => setCovering(true));
        return;
      }
      if (el?.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
        return;
      }
    } catch {
      // fall through
    }
    setCovering(true);
  }, [covering]);
  useEffect(() => {
    if (!covering) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCovering(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [covering]);

  useEffect(() => {
    if (status === "nowebgl") return;
    const host = hostRef.current;
    if (!host) return;
    const F = SPLAT_FEEL;
    const grid = SHOP_WALK_GRID;
    let disposed = false;
    const abort = new AbortController();

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      setStatus("nowebgl");
      return;
    }
    // splats are fill-heavy: start at most 1.5× and let the frame rate pick
    // the resolution (adaptive quality in the loop below)
    const q = new URLSearchParams(window.location.search);
    const maxPr = Math.min(1.5, window.devicePixelRatio || 1);
    const minPr = Math.min(maxPr, SPLAT_FEEL.minPixelRatio);
    let pr = maxPr;
    renderer.setPixelRatio(pr);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x101010, 1);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(70, 1, 0.05, 100);
    camera.rotation.order = "YXZ";
    // test switches: ?sd=2 narrower splats (less to draw), ?lod=1 Spark's level of detail
    const sd = Number(q.get("sd"));
    const spark = new SparkRenderer({ renderer, ...(sd > 0 ? { maxStdDev: sd } : {}) });
    scene.add(spark);
    let splat: SplatMesh | null = null;

    let pos = nearestFree(grid, F.start.x, F.start.z);
    let yawDeg = F.start.yawDeg;
    let pitchDeg = -4;
    let walked = 0;
    let lastStep = 0;
    let ready = false;

    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    fetchWithProgress(SPLAT_WALK.url, (p) => !disposed && setPct(p), abort.signal)
      .then(async (bytes) => {
        if (disposed) return;
        setPct(100);
        splat = new SplatMesh({ fileBytes: bytes, fileName: "shop.spz", ...(q.get("lod") === "1" ? { lod: true } : {}) });
        scene.add(splat);
        await splat.initialized;
        if (disposed) return;
        ready = true;
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setErrDetail(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });

    // keys
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (!TOUR_KEYS.has(e.code)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      keys.add(e.code);
      setHintVisible(false);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // drag to look (finger right = look right, down = look down)
    const pointers = new Map<number, { x: number; y: number }>();
    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      setHintVisible(false);
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size !== 1) return;
      const degPerPx = camera.fov / Math.max(1, host.clientHeight);
      yawDeg = normDeg(yawDeg + (cur.x - prev.x) * degPerPx);
      pitchDeg = Math.max(-70, Math.min(70, pitchDeg - (cur.y - prev.y) * degPerPx));
    };
    const onPointerUp = (e: PointerEvent) => pointers.delete(e.pointerId);
    const noTouchDefault = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener("touchstart", noTouchDefault, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    // sound needs the first gesture
    const gestureEvents = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    const onFirstGesture = () => {
      if (soundOnRef.current) ensureAudio();
    };
    gestureEvents.forEach((ev) => window.addEventListener(ev, onFirstGesture));

    let raf = 0;
    let last = performance.now();
    let foot: "left" | "right" = "left";
    let frames = 0;
    let winStart = performance.now();
    let fps = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - last) / 1000);
      // adaptive quality: below the target frame rate lower the resolution,
      // with headroom raise it again (checked every 1.5 s once loaded)
      frames++;
      if (now - winStart >= 1500) {
        fps = (frames * 1000) / (now - winStart);
        frames = 0;
        winStart = now;
        const lower = fps < SPLAT_FEEL.lowFps && pr > minPr;
        const raise = fps > SPLAT_FEEL.highFps && pr < maxPr;
        if (ready && (lower || raise)) {
          pr = lower ? Math.max(minPr, pr * 0.75) : Math.min(maxPr, pr * 1.15);
          renderer.setPixelRatio(pr);
          resize();
        }
      }
      last = now;
      if (ready) {
        const stick = mergeSticks(stickRef.current, keysToStick(keys));
        const turn = stickAxis(stick.x, F.deadZone);
        const ahead = stickAxis(stick.y, F.deadZone);
        if (turn !== 0) yawDeg = normDeg(yawDeg + turn * F.turnDegPerSec * dt);
        if (ahead !== 0) {
          const f = forwardOf(yawDeg);
          const d = ahead * F.speed * dt;
          const next = moveWithCollision(grid, pos, f.x * d, f.z * d);
          walked += Math.hypot(next.x - pos.x, next.z - pos.z);
          pos = next;
          if (walked - lastStep >= F.strideM) {
            lastStep = walked;
            foot = foot === "left" ? "right" : "left";
            if (soundOnRef.current) footstepsRef.current?.play(foot, Math.min(1, Math.abs(ahead) + 0.3));
          }
        }
      }
      const bob = Math.sin((walked / F.strideM) * Math.PI) * F.bobM;
      camera.position.set(pos.x, F.eyeHeight + Math.abs(bob), pos.z);
      camera.rotation.set((pitchDeg * Math.PI) / 180, (-yawDeg * Math.PI) / 180, 0);
      renderer.render(scene, camera);
      window.__splat = { ready, x: pos.x, z: pos.z, yawDeg, pitchDeg, walked, fps, pixelRatio: pr };
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      abort.abort();
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      gestureEvents.forEach((ev) => window.removeEventListener(ev, onFirstGesture));
      canvas.removeEventListener("touchstart", noTouchDefault);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      splat?.dispose();
      renderer.dispose();
      canvas.remove();
      delete window.__splat;
      void footstepsRef.current?.close();
      footstepsRef.current = null;
    };
    // set up once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "nowebgl") {
    return (
      <div className="relative isolate flex h-full w-full items-center justify-center overflow-hidden bg-[#101010] p-6">
        <p className="max-w-md rounded-lg bg-black/55 px-4 py-3 text-center text-sm text-white">
          თქვენი ბრაუზერი 3D ხედს ვერ აჩვენებს (საჭიროა WebGL 2). სცადეთ სხვა ბრაუზერი ან განაახლეთ არსებული.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`${covering ? "fixed inset-0 z-[70] h-[100dvh] w-screen" : "relative h-full w-full"} isolate select-none overflow-hidden overscroll-none bg-[#101010]`}
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    >
      <div ref={hostRef} className="absolute inset-0 touch-none" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101010] text-white">
          <p className="text-sm font-medium" aria-live="polite">
            შოურუმი იტვირთება… {pct}%
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101010]/90 p-6 text-center text-sm text-white">
          <p>
            შოურუმი ვერ ჩაიტვირთა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.
            {errDetail && <span className="mt-2 block text-xs text-white/60">({errDetail})</span>}
          </p>
        </div>
      )}

      {status === "ready" && hintVisible && (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[16rem] rounded-lg bg-black/55 px-3 py-2 text-xs leading-snug text-white">
          {touch
            ? "ჯოისტიკი ან ისარი წინ — სიარული, უკან — უკუსვლა, გვერდზე — მობრუნება. თითით გადაათრიეთ — მიმოხედვა."
            : "↑/W — სიარული, ↓/S — უკან, ←/→ ან A/D — მობრუნება. მაუსით გადაათრიეთ — მიმოხედვა."}
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
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-pressed={fullscreen || covering}
          aria-label={fullscreen || covering ? "სრული ეკრანიდან გასვლა" : "სრულ ეკრანზე"}
          className="absolute right-16 top-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
        >
          {fullscreen || covering ? <Minimize2 className="h-5 w-5" aria-hidden /> : <Maximize2 className="h-5 w-5" aria-hidden />}
        </button>
      )}

      {status === "ready" &&
        (controls === "arrows" ? (
          <DPad
            onChange={(axes) => {
              stickRef.current = axes;
            }}
          />
        ) : (
          <Joystick
            onChange={(axes) => {
              stickRef.current = axes;
            }}
          />
        ))}

      {status === "ready" && (
        <button
          type="button"
          onClick={switchControls}
          aria-label={controls === "arrows" ? "ჯოისტიკზე გადართვა" : "ისრებზე გადართვა"}
          className="absolute bottom-4 z-20 flex h-11 items-center gap-1.5 rounded-full bg-black/55 px-3 text-xs text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          style={{ left: controls === "arrows" ? 196 : 160 }}
        >
          {controls === "arrows" ? <Gamepad2 className="h-4 w-4" aria-hidden /> : <MoveVertical className="h-4 w-4" aria-hidden />}
          {controls === "arrows" ? "ჯოისტიკი" : "ისრები"}
        </button>
      )}
    </div>
  );
}
