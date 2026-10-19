import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import {
  CanvasTexture,
  CircleGeometry,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  VideoTexture,
  WebGLRenderer,
} from "three";
import Joystick from "./Joystick";
import { easeToward, keysToStick, mergeSticks, normDeg, TOUR_KEYS, turnRateFromStick, type StickAxes } from "@/lib/tour/tourMath";
import {
  distanceAt,
  facingFromView,
  headingAt,
  followStep,
  followTarget,
  footprints,
  planWalk,
  forwardTime,
  loopJump,
  vfovFor,
  videoTime,
  walkFromStick,
  WALK_FEEL,
  WALK_TRACK,
  WALK_VIDEO,
  type Facing,
  type WalkDir,
  type WalkIntent,
} from "@/lib/tour/walkTrack";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";
import { createAmbientMusic, type AmbientMusic } from "@/lib/tour/ambientMusic";

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
    // on unless the visitor turned it off before
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
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

/** A right shoe print, white on transparent (tinted by the material), toe up. */
function drawShoePrint(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 160;
  const g = c.getContext("2d");
  if (!g) return c;
  g.fillStyle = "#fff";
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 6;
  // sole: wide at the ball, narrowing to the arch (right shoe: arch on the left)
  g.beginPath();
  g.moveTo(34, 8);
  g.bezierCurveTo(52, 8, 58, 30, 56, 52);
  g.bezierCurveTo(55, 70, 50, 84, 44, 94);
  g.lineTo(22, 94);
  g.bezierCurveTo(18, 80, 8, 62, 10, 40);
  g.bezierCurveTo(12, 20, 20, 8, 34, 8);
  g.fill();
  // heel
  g.beginPath();
  g.ellipse(33, 128, 16, 22, 0, 0, Math.PI * 2);
  g.fill();
  return c;
}

export default function VideoWalk() {
  const hostRef = useRef<HTMLDivElement>(null);
  const frozenRef = useRef<HTMLCanvasElement>(null);
  const stickRef = useRef<StickAxes>({ x: 0, y: 0 });
  const footstepsRef = useRef<Footsteps | null>(null);
  const musicRef = useRef<AmbientMusic | null>(null);
  const soundOnRef = useRef(false);
  const unlockRef = useRef<() => void>(() => {});
  const startRef = useRef<() => void>(() => {});
  const [status, setStatus] = useState<Status>(() => (hasWebGL() ? "loading" : "nowebgl"));
  const [soundOn, setSoundOn] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // full screen: the Fullscreen API where it exists (Android, desktop, iPad);
  // iPhone Safari has none for a page element, so there the viewer just
  // covers the whole window (site header and chat button hidden)
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
      // fall through to covering the window
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

  // sound (footsteps + quiet music): on by default, but audio may only start
  // from the visitor's own tap / key press
  const ensureAudio = useCallback(() => {
    if (!footstepsRef.current) footstepsRef.current = createFootsteps({ volume: 0.3, pitchHz: 70, pitchSpread: 0.08 });
    void footstepsRef.current?.resume();
    if (!musicRef.current) musicRef.current = createAmbientMusic(0.05);
    void musicRef.current?.start();
  }, []);
  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    writeSoundPref(next);
    if (next) ensureAudio();
    else {
      void footstepsRef.current?.suspend();
      void musicRef.current?.stop();
    }
  }, [ensureAudio]);

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
    // colour lift: saturation + contrast on the final sRGB colour
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <colorspace_fragment>",
        [
          "#include <colorspace_fragment>",
          `{ vec3 c = gl_FragColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));`,
          `  c = mix(vec3(l), c, ${F.saturation.toFixed(3)});`,
          `  c = (c - 0.5) * ${F.contrast.toFixed(3)} + 0.5;`,
          `  gl_FragColor.rgb = clamp(c, 0.0, 1.0); }`,
        ].join("\n"),
      );
    };
    const sphere = new Mesh(geometry, material);
    // three.js puts the frame's centre at −x; turn it to −z (the camera's yaw 0)
    sphere.rotation.y = -Math.PI / 2;
    scene.add(sphere);

    const logoDist = 10;
    const NL = WALK_VIDEO.nadirLogo;
    const coverR = logoDist * Math.tan((NL.widthDeg / 2) * DEG);
    const logoGeo = new CircleGeometry(coverR, 96);
    // the cover: dark disc with a soft edge, the logo drawn in once it loads
    const coverCanvas = document.createElement("canvas");
    coverCanvas.width = coverCanvas.height = 512;
    const drawCover = (img: HTMLImageElement | null) => {
      const g = coverCanvas.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, 512, 512);
      const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
      grad.addColorStop(0, "rgba(16,16,16,0.96)");
      grad.addColorStop(0.9, "rgba(16,16,16,0.96)");
      grad.addColorStop(1, "rgba(16,16,16,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 512);
      if (img) {
        const frac = Math.tan((NL.logoWidthDeg / 2) * DEG) / Math.tan((NL.widthDeg / 2) * DEG);
        const d = 512 * frac;
        g.drawImage(img, 256 - d / 2, 256 - d / 2, d, d);
      }
    };
    drawCover(null);
    const coverTex = new CanvasTexture(coverCanvas);
    coverTex.colorSpace = SRGBColorSpace;
    const logoMat = new MeshBasicMaterial({ map: coverTex, transparent: true, depthTest: false, depthWrite: false });
    const logo = new Mesh(logoGeo, logoMat);
    logo.position.set(0, -logoDist, 0);
    logo.rotation.x = -Math.PI / 2;
    logo.renderOrder = 3;
    scene.add(logo);
    const logoImg = new Image();
    logoImg.onload = () => {
      if (disposed) return;
      drawCover(logoImg);
      coverTex.needsUpdate = true;
    };
    logoImg.src = NL.url;

    // ── footprints on the floor (where the walk goes next) ─────────────────
    const ST = F.steps;
    const printTex = new CanvasTexture(drawShoePrint());
    printTex.colorSpace = SRGBColorSpace;
    const printGeo = new PlaneGeometry(ST.footWidthM, ST.footLenM);
    const printCount = Math.ceil(ST.lengthM / ST.strideM) + 2;
    const prints: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
    for (let i = 0; i < printCount; i++) {
      const m = new MeshBasicMaterial({ map: printTex, color: 0xffd36b, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(printGeo, m);
      mesh.rotation.order = "YXZ";
      mesh.renderOrder = 4; // above the nadir cover: the prints lead out of it onto the floor
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);
      prints.push(mesh);
    }
    const updatePrints = (t: number, d: WalkDir, alpha: number) => {
      const fp = footprints(t, d);
      for (let i = 0; i < prints.length; i++) {
        const mesh = prints[i];
        const p = fp[i];
        if (!p || alpha < 0.02) {
          mesh.visible = false;
          continue;
        }
        const near = Math.min(1, (p.r - ST.startM) / 0.35);
        const far = 1 - Math.pow((p.r - ST.startM) / ST.lengthM, 2);
        mesh.material.opacity = alpha * Math.max(0, near) * Math.max(0, far);
        mesh.visible = mesh.material.opacity > 0.01;
        mesh.position.set(p.x, -ST.cameraHeightM, p.z);
        mesh.rotation.y = -p.hDeg * DEG;
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.x = p.side; // the print is a right shoe; mirrored = left
      }
    };
    let printAlpha = 0;
    let printDir: WalkDir = "fwd";

    // ── view state ─────────────────────────────────────────────────────────
    let yawDeg = headingAt(track.start); // facing the way the walk starts
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
    let stepPhase = 0; // footfalls at whole numbers (distance / stride)
    let lastStepNo: number | null = null;
    let bobAmp = 0;
    let facing: Facing = "along";
    let activeIntent: WalkIntent | null = null;
    const reduceMotion = media("(prefers-reduced-motion: reduce)");
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

    /**
     * Seek `v`; resolves true once the frame at that time is decoded
     * (readyState ≥ HAVE_CURRENT_DATA after "seeked"), false after
     * `timeoutMs` without it — on a phone the bytes may still be downloading.
     */
    const seekTo = (v: HTMLVideoElement, time: number, timeoutMs = 1500) =>
      new Promise<boolean>((resolve) => {
        const clamped = Math.min(Math.max(0, time), (v.duration || track.duration) - 0.05);
        if (Math.abs(v.currentTime - clamped) < 0.01 && v.readyState >= 2 && !v.seeking) return resolve(true);
        let done = false;
        let timer = 0;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          v.removeEventListener("seeked", onEvent);
          v.removeEventListener("loadeddata", onEvent);
          v.removeEventListener("canplay", onEvent);
          resolve(ok);
        };
        // there = not seeking, the frame decoded, and really at that time (a
        // host without byte ranges can't seek: the video stays where it was)
        const there = () => !v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - clamped) < 0.5;
        const onEvent = () => {
          if (there()) finish(true);
        };
        v.addEventListener("seeked", onEvent);
        v.addEventListener("loadeddata", onEvent);
        v.addEventListener("canplay", onEvent);
        timer = window.setTimeout(() => finish(there()), timeoutMs);
        v.currentTime = clamped;
      });

    /** Keep the idle video parked at the same moment, so a change of direction is instant. */
    let parking = false;
    let lastPark = 0;
    const parkIdle = () => {
      if (parking || switching || jumping) return;
      const idle: WalkDir = dir === "fwd" ? "rev" : "fwd";
      const v = videos[idle];
      if (v.readyState < 1) return;
      const want = videoTime(fwdTime(), idle, track);
      if (Math.abs(v.currentTime - want) < 0.3) return;
      parking = true;
      lastPark = performance.now();
      void seekTo(v, want, 4000).then(() => {
        parking = false;
      });
    };

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
      lastStepNo = null;
      if (wasPlaying && rate > 0) safePlay(v);
      releaseFrame();
      jumping = false;
    };

    // Changing direction: the other video seeks to the same moment first;
    // until its frame is there the current picture stays (no wrong frame, no
    // turning toward a wrong place). If it can't get there, stay put.
    let switchFailedAt = -1e9;
    const switchDir = async (next: WalkDir) => {
      if (switching || next === dir || performance.now() - switchFailedAt < 800) return;
      switching = true;
      const t = fwdTime();
      const from = active();
      from.pause();
      playing = false;
      const to = videos[next];
      const ok = await seekTo(to, videoTime(t, next, track), 5000);
      if (disposed) return;
      if (ok) {
        dir = next;
        material.map = textures[next];
        textures[next].needsUpdate = true;
      } else {
        switchFailedAt = performance.now();
      }
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
    let lastTurnAt = 0;
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
        // like a game camera: finger right = look right, finger down = look down
        yawDeg = normDeg(yawDeg + (cur.x - prev.x) * degPerPx);
        pitchDeg = Math.max(-85, Math.min(85, pitchDeg - (cur.y - prev.y) * degPerPx));
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
    // iPhone: no long-press selection / magnifier on the picture (pointer events still fire)
    const noTouchDefault = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener("touchstart", noTouchDefault, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── loading ────────────────────────────────────────────────────────────
    const fv = videos.fwd;
    const onReady = () => {
      if (ready || disposed) return;
      void seekTo(fv, track.start).then(() => {
        if (disposed || ready) return;
        textures.fwd.needsUpdate = true;
        ready = true;
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
        turnRate = easeToward(turnRate, turnRateFromStick(stick.x, { deadZone: F.turnDeadZone, maxTurnDegPerSec: F.turnMaxDegPerSec }), dt);
        if (Math.abs(stick.x) > F.turnDeadZone) lastTurnAt = now;
        if (Math.abs(turnRate) > 0.05) {
          yawDeg = normDeg(yawDeg + turnRate * (dt / 1000));
          setHintVisible(false);
        } else turnRate = 0;

        // walking: the way the visitor faces when the push starts decides the
        // direction (turned round + push up = back the way the walk came)
        const want = walkFromStick(stick.y);
        if (!want) activeIntent = null;
        else if (want.intent !== activeIntent) {
          activeIntent = want.intent;
          facing = facingFromView(yawDeg, fwdTime());
        }
        const wantDir = want ? planWalk(want.intent, facing) : null;
        if (wantDir) printDir = wantDir;
        if (wantDir && wantDir !== dir) void switchDir(wantDir);
        const target = want && wantDir === dir && !switching ? want.rate : 0;
        rate = easeToward(rate, target, dt, F.rateEaseMs);
        const v = active();
        if (target > 0 && !switching) {
          if (!playing) {
            safePlay(v);
            playing = true;
            setHintVisible(false);
          }
        } else if (playing && rate < F.stopRate) {
          v.pause();
          playing = false;
          rate = 0;
          lastStepNo = null;
          parkIdle();
        }
        if (playing) {
          const r = Math.max(0.25, Math.round(rate * 20) / 20);
          if (Math.abs(v.playbackRate - r) > 0.01) v.playbackRate = r;
          // view follows the path (not while the visitor turns or drags)
          const t = fwdTime();
          // steps: one footfall per stride of distance actually walked in the
          // video (none while it stands still); the head bob follows the same phase
          const walked = distanceAt(t, track);
          const stepNo = Math.floor(walked / F.steps.strideM);
          if (stepNo !== lastStepNo) {
            if (lastStepNo !== null) footfall();
            lastStepNo = stepNo;
          }
          stepPhase = walked / F.steps.strideM;
          const busyLooking = pointers.size > 0 || now - Math.max(lastDragAt, lastTurnAt) < F.followDelayMs;
          if (!busyLooking) {
            const scaled = { followMaxDegPerSec: F.followMaxDegPerSec * Math.min(1.2, r), followEaseMs: F.followEaseMs };
            yawDeg = followStep(yawDeg, followTarget(t, dir, facing), dt, scaled);
            pitchDeg = easeToward(pitchDeg, F.walkPitchDeg, dt, F.pitchEaseMs);
          }
          // keep the other direction ready
          if (now - lastPark > F.parkEveryMs) parkIdle();
          // the loop point
          const next = loopJump(t, dir, track);
          if (next !== null) void jumpTo(next);
          // the very ends of the video (before the loop start / after its end)
          if (dir === "fwd" && t >= track.duration - 0.1) v.pause();
          if (dir === "rev" && t <= 0.1) v.pause();
        }
      }

      // footprints: shown while the stick is held or the walk runs
      if (ready) {
        const st = mergeSticks(stickRef.current, keysToStick(keys));
        const show = playing || Math.abs(st.y) > 0.08;
        printAlpha = easeToward(printAlpha, show ? 0.8 : 0, dt, show ? 120 : 450);
        updatePrints(fwdTime(), printDir, printAlpha);
      }

      // head bob: a small dip on every footfall and a sway from foot to foot
      bobAmp = easeToward(bobAmp, playing && !reduceMotion ? Math.min(1.2, rate) : 0, dt, 200);
      const ph = stepPhase * Math.PI;
      const bobPitch = -F.bobPitchDeg * bobAmp * Math.pow(Math.sin(ph), 2);
      const bobRoll = F.bobRollDeg * bobAmp * Math.sin(ph);

      camera.fov = vfov * userZoom;
      camera.updateProjectionMatrix();
      camera.rotation.y = -yawDeg * DEG;
      camera.rotation.x = (pitchDeg + bobPitch) * DEG;
      camera.rotation.z = bobRoll * DEG;
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

    // sound is on by default but needs the visitor's first tap / key press
    // (iPhone unlocks audio on the end of a touch, so listen to both ends)
    const gestureEvents = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    const onFirstGesture = () => {
      if (soundOnRef.current) ensureAudio();
    };
    if (readSoundPref()) {
      soundOnRef.current = true;
      setSoundOn(true);
      gestureEvents.forEach((ev) => window.addEventListener(ev, onFirstGesture));
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
      gestureEvents.forEach((ev) => window.removeEventListener(ev, onFirstGesture));
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("touchstart", noTouchDefault);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
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
      coverTex.dispose();
      logoMat.dispose();
      logoGeo.dispose();
      printGeo.dispose();
      printTex.dispose();
      prints.forEach((m) => m.material.dispose());
      material.dispose();
      geometry.dispose();
      renderer.dispose();
      canvas.remove();
      delete window.__walk;
      unlockRef.current = () => {};
      void footstepsRef.current?.close();
      footstepsRef.current = null;
      void musicRef.current?.close();
      musicRef.current = null;
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
    <div
      ref={rootRef}
      className={`${covering ? "fixed inset-0 z-[70] h-[100dvh] w-screen" : "relative h-full w-full"} isolate select-none overflow-hidden overscroll-none bg-[#101010]`}
      // iPhone: a long press (holding the joystick) must not start a text selection / callout
      style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", WebkitTapHighlightColor: "transparent" }}
    >
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
            შოურუმი იტვირთება…
          </p>
          {/* no percentage: phones don't report video download progress reliably */}
          <style>{"@keyframes maika-walk-load{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}"}</style>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full w-2/5 rounded-full bg-amber-400"
              style={{ animation: "maika-walk-load 1.1s ease-in-out infinite" }}
            />
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

      {status === "ready" && !touch && (
        <p className="pointer-events-none absolute bottom-[150px] left-4 z-20 rounded-md bg-black/45 px-2 py-1 text-[11px] leading-tight text-white/90">
          ↑ სიარული · ↓ უკან · ← → მობრუნება
        </p>
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
