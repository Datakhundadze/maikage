import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import {
  CircleGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  VideoTexture,
  WebGLRenderer,
} from "three";
import Joystick from "./Joystick";
import { easeToward, keysToStick, mergeSticks, normDeg, TOUR_KEYS, turnRateFromStick, type StickAxes } from "@/lib/tour/tourMath";
import {
  followStep,
  followTarget,
  forwardTime,
  loopJump,
  vfovFor,
  videoTime,
  walkFromStick,
  WALK_FEEL,
  WALK_TRACK,
  WALK_VIDEO,
  type WalkDir,
} from "@/lib/tour/walkTrack";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";

// /showroom walk-through: a 360° video of a loop around the shop, played
// forward or backward while the joystick is held (walkTrack.ts has the files
// and the track). three.js renders the frame on the inside of a sphere; this
// file is imported only from the lazy ShowroomPage.
//
// CONTROLS
//   joystick (bottom-left) / ↑↓ or W S: hold forward to walk along the loop,
//     back to step backward; further = faster. ←→ / A D / stick x: turn.
//   drag anywhere else: look around; wheel / pinch: zoom.
// WALKING: the video of the matching direction plays (walk-rev.mp4 for
// backward, so both are smooth); switching direction seeks the other video to
// the same moment first and swaps once it's there. While walking the view
// turns toward the path a little ahead (WALK_FEEL), unless the visitor is
// turning or dragging; at the loop point the walk continues from the start
// with a short cross-fade (the last frame is frozen on a 2D canvas on top).
// LAYERS: the wrapper is `isolate`, below the sitewide chat launcher (z-50);
// nothing sits in the bottom-right corner.

const DEG = Math.PI / 180;
const SOUND_KEY = "maika.showroom.sound";
const MIN_VFOV = 35;
const MAX_VFOV = 100;
const SPHERE_R = 50;

type Status = "loading" | "ready" | "error" | "nowebgl";

declare global {
  interface Window {
    /** Read-only state for browser checks. */
    __walk?: {
      t: number;
      dir: WalkDir;
      playing: boolean;
      rate: number;
      yawDeg: number;
      pitchDeg: number;
      jumps: number;
      ready: boolean;
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

/** H.264 MP4 where it plays (every current browser); WebM only as a fallback for builds without H.264. */
function videoUrl(dir: WalkDir): string {
  const probe = document.createElement("video");
  const mp4 = probe.canPlayType('video/mp4; codecs="avc1.640033"') !== "";
  return `${WALK_VIDEO.base}-${dir}.${mp4 ? "mp4" : "webm"}`;
}

function makeVideo(dir: WalkDir, preload: "auto" | "metadata"): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.crossOrigin = "anonymous";
  v.preload = preload;
  v.loop = false;
  v.src = videoUrl(dir);
  return v;
}

export default function VideoWalk() {
  const hostRef = useRef<HTMLDivElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<StickAxes>({ x: 0, y: 0 });
  const footstepsRef = useRef<Footsteps | null>(null);
  const soundOnRef = useRef(false);
  const unlockRef = useRef<() => void>(() => {});
  const startRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<Status>(() => (hasWebGL() ? "loading" : "nowebgl"));
  const [progress, setProgress] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const [touch] = useState(() => media("(pointer: coarse)"));
  // iPhone Safari does not load a video before a tap: after a moment without
  // data the loader shows a start button (the tap starts the download)
  const [needsTap, setNeedsTap] = useState(false);
  const [errDetail, setErrDetail] = useState("");
  const [debug] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("debug") === "1";
    } catch {
      return false;
    }
  });
  const [debugText, setDebugText] = useState("");

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
    const track = WALK_TRACK;
    const F = WALK_FEEL;

    // ── renderer, sphere, nadir logo ───────────────────────────────────────
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch {
      setStatus("nowebgl");
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x101010, 1);
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.touchAction = "none";
    host.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(75, 1, 0.1, 200);
    camera.rotation.order = "YXZ";

    const videos: Record<WalkDir, HTMLVideoElement> = { fwd: makeVideo("fwd", "auto"), rev: makeVideo("rev", "metadata") };
    const textures: Record<WalkDir, VideoTexture> = { fwd: new VideoTexture(videos.fwd), rev: new VideoTexture(videos.rev) };
    for (const tex of Object.values(textures)) {
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = false;
    }
    const geometry = new SphereGeometry(SPHERE_R, 96, 64);
    geometry.scale(-1, 1, 1); // seen from inside, not mirrored
    const material = new MeshBasicMaterial({ map: textures.fwd });
    const sphere = new Mesh(geometry, material);
    // three.js puts the frame's centre at −x; turn it to −z (the camera's yaw 0)
    sphere.rotation.y = -Math.PI / 2;
    scene.add(sphere);

    const logoDist = 10;
    const logoGeo = new CircleGeometry(logoDist * Math.tan((WALK_VIDEO.nadirLogo.widthDeg / 2) * DEG), 64);
    const logoMat = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    const logo = new Mesh(logoGeo, logoMat);
    logo.position.set(0, -logoDist, 0);
    logo.rotation.x = -Math.PI / 2;
    logo.renderOrder = 1;
    logo.visible = false;
    scene.add(logo);
    const logoLoader = new TextureLoader();
    logoLoader.load(WALK_VIDEO.nadirLogo.url, (tex) => {
      if (disposed) return tex.dispose();
      tex.colorSpace = SRGBColorSpace;
      logoMat.map = tex;
      logoMat.needsUpdate = true;
      logo.visible = true;
    });

    // ── view state ─────────────────────────────────────────────────────────
    let yawDeg = 0;
    let pitchDeg = 0;
    let vfov = vfovFor(host.clientWidth, host.clientHeight, 100, MIN_VFOV, MAX_VFOV);
    let userZoom = 1; // multiplies vfov (pinch / wheel)
    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      vfov = vfovFor(w, h, 100, MIN_VFOV, MAX_VFOV);
      camera.aspect = w / h;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ── playback state ─────────────────────────────────────────────────────
    let ready = false;
    let dir: WalkDir = "fwd";
    let playing = false;
    let rate = 0; // eased playback rate (0 = standing)
    let switching = false; // waiting for the other video to seek
    let jumping = false; // loop jump in progress
    let jumps = 0;
    let stepClock = 0;
    let footIndex = 0;
    const active = () => videos[dir];
    const fwdTime = () => forwardTime(active().currentTime, dir, track);

    const publish = () => {
      window.__walk = { t: fwdTime(), dir, playing, rate, yawDeg, pitchDeg, jumps, ready };
    };

    const safePlay = (v: HTMLVideoElement) => {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };
    const pauseAll = () => {
      videos.fwd.pause();
      videos.rev.pause();
      playing = false;
    };

    /** Seek `v` and resolve once the frame is there (or after a timeout). */
    const seekTo = (v: HTMLVideoElement, time: number) =>
      new Promise<void>((resolve) => {
        const clamped = Math.min(Math.max(0, time), (v.duration || track.duration) - 0.05);
        if (Math.abs(v.currentTime - clamped) < 0.01) return resolve();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          v.removeEventListener("seeked", finish);
          resolve();
        };
        v.addEventListener("seeked", finish);
        window.setTimeout(finish, 1500);
        v.currentTime = clamped;
      });

    // iOS: a video may only start from a user gesture the first time; touch
    // both on the first joystick / key press
    let unlocked = false;
    unlockRef.current = () => {
      if (unlocked) return;
      unlocked = true;
      for (const d of ["fwd", "rev"] as WalkDir[]) {
        const v = videos[d];
        if (d === "rev" && v.preload !== "auto") {
          v.preload = "auto";
          v.load();
        }
        // the one shown keeps playing if a walk has started by then
        const keep = () => d === dir && playing;
        const p = v.play();
        if (p && typeof p.then === "function") p.then(() => (keep() ? undefined : v.pause())).catch(() => {});
        else if (!keep()) v.pause();
      }
    };

    // ── the frozen frame for the loop cross-fade ───────────────────────────
    const freezeFrame = (): boolean => {
      const out = frozenRef.current;
      if (!out || !canvas.width) return false;
      try {
        out.width = canvas.width;
        out.height = canvas.height;
        out.getContext("2d")?.drawImage(canvas, 0, 0);
      } catch {
        return false;
      }
      out.style.transition = "none";
      out.style.opacity = "1";
      out.style.visibility = "visible";
      return true;
    };
    const releaseFrame = () => {
      const out = frozenRef.current;
      if (!out) return;
      requestAnimationFrame(() => {
        out.style.transition = `opacity ${F.loopFadeMs}ms ease-out`;
        out.style.opacity = "0";
      });
      window.setTimeout(() => {
        if (out) out.style.visibility = "hidden";
      }, F.loopFadeMs + 50);
    };
    let wantFreeze = false; // freeze right after the next render (the buffer is valid then)

    const jumpTo = async (t: number) => {
      jumping = true;
      wantFreeze = true;
      // wait for the render that captures the frozen frame
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const v = active();
      const wasPlaying = playing;
      v.pause();
      await seekTo(v, videoTime(t, dir, track));
      if (disposed) return;
      textures[dir].needsUpdate = true;
      jumps++;
      if (wasPlaying && rate > 0) safePlay(v);
      releaseFrame();
      jumping = false;
    };

    const switchDir = async (next: WalkDir) => {
      if (switching || next === dir) return;
      switching = true;
      const t = fwdTime();
      const from = active();
      from.pause();
      playing = false;
      const to = videos[next];
      await seekTo(to, videoTime(t, next, track));
      if (disposed) return;
      dir = next;
      material.map = textures[next];
      textures[next].needsUpdate = true;
      switching = false;
    };

    // ── input: keys, drag, wheel / pinch ───────────────────────────────────
    const keys = new Set<string>();
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
    const onKeyDown = (e: KeyboardEvent) => {
      if (!TOUR_KEYS.has(e.code) || e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      e.preventDefault();
      keys.add(e.code);
      unlockRef.current();
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;
    let lastDragAt = 0;
    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      setHintVisible(false);
    };
    const onPointerMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        const degPerPx = (vfov * userZoom) / Math.max(1, host.clientHeight);
        yawDeg = normDeg(yawDeg - (cur.x - prev.x) * degPerPx);
        pitchDeg = Math.max(-85, Math.min(85, pitchDeg + (cur.y - prev.y) * degPerPx));
        lastDragAt = performance.now();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0 && d > 0) userZoom = Math.max(MIN_VFOV / vfov, Math.min(1, userZoom * (pinchDist / d)));
        pinchDist = d;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userZoom = Math.max(MIN_VFOV / vfov, Math.min(1, userZoom * Math.exp(e.deltaY * 0.001)));
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── loading ────────────────────────────────────────────────────────────
    const fv = videos.fwd;
    const onProgress = () => {
      if (ready) return;
      try {
        const d = fv.duration || track.duration;
        const end = fv.buffered.length ? fv.buffered.end(fv.buffered.length - 1) : 0;
        // the start needs only a few seconds
        setProgress(Math.min(99, Math.round((end / Math.min(d, track.start + 6)) * 100)));
      } catch {
        // buffered not readable yet
      }
    };
    const onReady = () => {
      if (ready || disposed) return;
      void seekTo(fv, track.start).then(() => {
        if (disposed || ready) return;
        textures.fwd.needsUpdate = true;
        ready = true;
        setProgress(100);
        setStatus("ready");
        publish();
      });
    };
    const onError = () => {
      if (ready) return;
      const e = fv.error;
      setErrDetail(e ? `კოდი ${e.code}${e.message ? ` — ${e.message}` : ""}` : "");
      setStatus("error");
    };
    // no data after a moment (iPhone): offer the start button
    const tapTimer = window.setTimeout(() => {
      if (!ready && !disposed) setNeedsTap(true);
    }, 1500);
    startRef.current = () => {
      setNeedsTap(false);
      unlockRef.current();
      // a play() refused for a reason other than "needs a gesture" is an error
      const p = fv.play();
      if (p && typeof p.then === "function")
        p.then(() => {
          if (!playing) fv.pause();
          onReady();
        }).catch((e: unknown) => {
          const name = e instanceof Error ? e.name : String(e);
          if (name !== "AbortError" && !ready) {
            setErrDetail(name);
            setStatus("error");
          }
        });
    };
    let debugTimer = 0;
    if (debug) {
      debugTimer = window.setInterval(() => {
        const v = active();
        const b = v.buffered.length ? v.buffered.end(v.buffered.length - 1).toFixed(1) : "0";
        setDebugText(
          `${dir} rs=${v.readyState} ns=${v.networkState} err=${v.error?.code ?? "-"} t=${v.currentTime.toFixed(2)} buf=${b} paused=${v.paused} ${v.currentSrc.split("/").pop()}`,
        );
      }, 500);
    }
    fv.addEventListener("progress", onProgress);
    fv.addEventListener("loadeddata", onReady);
    fv.addEventListener("canplay", onReady);
    fv.addEventListener("error", onError);
    if (fv.readyState >= 2) onReady();
    // preload the backward video once the forward one can play
    const preloadRev = () => {
      const rv = videos.rev;
      if (rv.preload !== "auto") {
        rv.preload = "auto";
        rv.load();
      }
    };
    fv.addEventListener("canplaythrough", preloadRev, { once: true });

    const onVisibility = () => {
      if (document.hidden) {
        pauseAll();
        rate = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // ── the frame loop ─────────────────────────────────────────────────────
    let turnRate = 0;
    let last = performance.now();
    let raf = 0;
    let lastPublish = 0;
    const footfall = () => {
      const f = footstepsRef.current;
      if (soundOnRef.current && f) f.play(footIndex % 2 === 0 ? "left" : "right", footIndex % 2 === 0 ? 0.8 : 0.72);
      footIndex++;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - last);
      last = now;

      if (ready && !jumping) {
        const stick = mergeSticks(stickRef.current, keysToStick(keys));
        // turning
        turnRate = easeToward(turnRate, turnRateFromStick(stick.x), dt);
        if (Math.abs(turnRate) > 0.05) {
          yawDeg = normDeg(yawDeg + turnRate * (dt / 1000));
          setHintVisible(false);
        } else turnRate = 0;

        // walking
        const want = walkFromStick(stick.y);
        if (want && want.dir !== dir) {
          void switchDir(want.dir);
        }
        const target = want && want.dir === dir && !switching ? want.rate : 0;
        rate = easeToward(rate, target, dt, F.rateEaseMs);
        const v = active();
        if (target > 0 && !switching) {
          if (!playing) {
            safePlay(v);
            playing = true;
            stepClock = F.footstepSec * 0.5;
            setHintVisible(false);
          }
        } else if (playing && rate < F.stopRate) {
          v.pause();
          playing = false;
          rate = 0;
        }
        if (playing) {
          const r = Math.max(0.25, Math.round(rate * 20) / 20);
          if (Math.abs(v.playbackRate - r) > 0.01) v.playbackRate = r;
          // footsteps
          stepClock -= (dt / 1000) * r;
          if (stepClock <= 0) {
            stepClock += F.footstepSec;
            footfall();
          }
          // view follows the path (not while the visitor turns or drags)
          const t = fwdTime();
          const busyLooking = Math.abs(stick.x) > 0.15 || pointers.size > 0 || now - lastDragAt < 400;
          if (!busyLooking) {
            const scaled = { followMaxDegPerSec: F.followMaxDegPerSec * Math.min(1.2, r), followEaseMs: F.followEaseMs };
            yawDeg = followStep(yawDeg, followTarget(t, dir), dt, scaled);
            pitchDeg = easeToward(pitchDeg, F.walkPitchDeg, dt, F.pitchEaseMs);
          }
          // the loop point
          const next = loopJump(t, dir, track);
          if (next !== null) void jumpTo(next);
          // the very ends of the video (before the loop start / after its end)
          if (dir === "fwd" && t >= track.duration - 0.1) v.pause();
          if (dir === "rev" && t <= 0.1) v.pause();
        }
      }

      camera.fov = vfov * userZoom;
      camera.updateProjectionMatrix();
      camera.rotation.y = -yawDeg * DEG;
      camera.rotation.x = pitchDeg * DEG;
      renderer.render(scene, camera);
      if (wantFreeze) {
        wantFreeze = false;
        freezeFrame();
      }
      if (now - lastPublish > 100) {
        lastPublish = now;
        publish();
      }
    };
    raf = requestAnimationFrame(loop);

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
      window.clearTimeout(tapTimer);
      window.clearInterval(debugTimer);
      startRef.current = () => {};
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onFirstGesture);
      window.removeEventListener("keydown", onFirstGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      fv.removeEventListener("progress", onProgress);
      fv.removeEventListener("loadeddata", onReady);
      fv.removeEventListener("canplay", onReady);
      fv.removeEventListener("error", onError);
      fv.removeEventListener("canplaythrough", preloadRev);
      for (const v of Object.values(videos)) {
        v.pause();
        v.removeAttribute("src");
        v.load();
      }
      Object.values(textures).forEach((t) => t.dispose());
      logoMat.map?.dispose();
      logoMat.dispose();
      logoGeo.dispose();
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      delete window.__walk;
      unlockRef.current = () => {};
      void footstepsRef.current?.close();
      footstepsRef.current = null;
    };
    // set up once; `status` is read only to skip setup without WebGL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "nowebgl") {
    return (
      <div className="relative isolate flex h-full w-full items-center justify-center overflow-hidden bg-[#101010] p-6">
        <p className="max-w-md rounded-lg bg-black/55 px-4 py-3 text-center text-sm text-white">
          თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს (საჭიროა WebGL). სცადეთ სხვა ბრაუზერი ან განაახლეთ არსებული.
        </p>
      </div>
    );
  }

  return (
    <div className="relative isolate h-full w-full overflow-hidden overscroll-none bg-[#101010]">
      <div ref={hostRef} className="absolute inset-0 touch-none" />
      <canvas
        ref={frozenRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ visibility: "hidden" }}
      />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101010] text-white">
          <p className="text-sm font-medium" aria-live="polite">
            შოურუმი იტვირთება… {progress}%
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-amber-400 transition-[width] duration-200" style={{ width: `${Math.max(5, progress)}%` }} />
          </div>
          {needsTap && (
            <button
              type="button"
              onClick={() => startRef.current()}
              className="pointer-events-auto mt-2 rounded-full bg-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-lg transition-colors hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              შესვლა შოურუმში
            </button>
          )}
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101010]/90 p-6 text-center text-sm text-white">
          <p>
            შოურუმის ვიდეო ვერ ჩაიტვირთა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.
            {errDetail && <span className="mt-2 block text-xs text-white/60">({errDetail})</span>}
          </p>
        </div>
      )}

      {debug && (
        <p className="pointer-events-none absolute bottom-36 left-3 right-3 z-30 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-lime-300">
          {status} {debugText}
        </p>
      )}

      {status === "ready" && hintVisible && (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[16rem] rounded-lg bg-black/55 px-3 py-2 text-xs leading-snug text-white">
          {touch
            ? "ჯოისტიკი წინ გეჭიროთ — იარეთ, უკან — უკუსვლა, გვერდზე — მობრუნება. თითით გადაათრიეთ — მიმოხედვა."
            : "↑/W დაჭერილი — სიარული, ↓/S — უკან, ←/→ ან A/D — მობრუნება. მაუსით გადაათრიეთ — მიმოხედვა."}
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
            if (axes.x !== 0 || axes.y !== 0) unlockRef.current();
            stickRef.current = axes;
          }}
        />
      )}
    </div>
  );
}
