import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Volume2, VolumeX } from "lucide-react";
import {
  CanvasTexture,
  CircleGeometry,
  FramebufferTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  ShaderMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  VideoTexture,
  Vector3,
  WebGLRenderer,
} from "three";
import { angleDiff, easeToward, keysToStick, mergeSticks, normDeg, TOUR_KEYS, turnRateFromStick, type StickAxes } from "@/lib/tour/tourMath";
import {
  distanceAt,
  headingAt,
  followStep,
  followTarget,
  footprints,
  globalTime,
  localTime,
  partIndexAt,
  loopJump,
  skipJump,
  vfovFor,
  playbackStep,
  WALK_FEEL,
  WALK_TRACK,
  WALK_VIDEO,
  type Facing,
  type WalkDir,
} from "@/lib/tour/walkTrack";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";
import { createAmbientMusic, type AmbientMusic } from "@/lib/tour/ambientMusic";
import { SHOWROOM_RACKS, type ShowroomRack } from "@/lib/tour/showroomRacks";
import { planRoute, reached, type RouteStep } from "@/lib/tour/autoWalk";

/** A place to walk to: a rack (its sheet opens on arrival) or the entrance. */
interface WalkDest {
  id: string;
  title: string;
  t: number;
  yawDeg: number;
  /** Where the view tilts on arrival (a rack right beside the walk is low in the picture); default: the walking tilt. */
  pitchDeg?: number;
  rack?: ShowroomRack;
}

/** Every rack (one per brand), then the entrance. */
const dests: WalkDest[] = [
  ...SHOWROOM_RACKS.map((r) => ({ id: r.id, title: r.title, t: r.stop.t, yawDeg: r.stop.yawDeg, pitchDeg: r.stop.pitchDeg, rack: r })),
  { id: "entrance", title: "შესასვლელი", t: WALK_TRACK.start, yawDeg: headingAt(WALK_TRACK.start) },
];

/** Speed of the walk to a place (playback rate; 1 = as filmed, a slow walk). */
const AUTO_RATE = 1.4;
import RackSheet from "./RackSheet";

// /showroom walk-through: a 360° video of the shop, played forward or
// backward to walk (walkTrack.ts has the files and the track). three.js
// renders the frame on the inside of a sphere; this file is imported only
// from the lazy ShowroomPage.
//
// CONTROLS (2026-11-05: no joystick any more — David: walking by hand had too
// many rough spots; the walk only exists where the camera went)
//   tap a rack in the bar at the bottom: the walk goes there by itself along
//     the filmed passes (autoWalk.ts), turns to the rack and opens its sheet.
//   drag: look around (also while walking); wheel / pinch: zoom; ←→ / A D: turn.
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

/** iPhone / iPad Safari: no video download before a tap, so ask for the tap right away. */
function needsTapToLoad(): boolean {
  try {
    const ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}
const MIN_VFOV = 35;
const MAX_VFOV = 90;
const SPHERE_R = 50;

type Status = "loading" | "ready" | "error" | "nowebgl";

declare global {
  interface Window {
    /** Read-only state for browser checks. */
    __walk?: {
      t: number;
      dir: WalkDir;
      part: number;
      playing: boolean;
      rate: number;
      yawDeg: number;
      pitchDeg: number;
      jumps: number;
      ready: boolean;
      branches: number;
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

const RESUME_KEY = "maika.showroom.resume";
const RESUME_MAX_AGE_MS = 30 * 60 * 1000;

/** Where the visitor stood in this tab's last visit (sessionStorage, 30 min), if any. */
function readResume(): { t: number; dir: WalkDir; yawDeg: number } | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { t?: unknown; dir?: unknown; yawDeg?: unknown; at?: unknown };
    if (typeof v.t !== "number" || typeof v.yawDeg !== "number" || typeof v.at !== "number") return null;
    if (v.dir !== "fwd" && v.dir !== "rev") return null;
    if (Date.now() - v.at > RESUME_MAX_AGE_MS) return null;
    return { t: v.t, dir: v.dir, yawDeg: v.yawDeg };
  } catch {
    return null;
  }
}

function writeResume(v: { t: number; dir: WalkDir; yawDeg: number }): void {
  try {
    window.sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...v, at: Date.now() }));
  } catch {
    // storage blocked: no resume, nothing else changes
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
function videoUrl(base: string, dir: WalkDir): string {
  const probe = document.createElement("video");
  const mp4 = probe.canPlayType('video/mp4; codecs="avc1.640033"') !== "";
  return `${base}-${dir}.${mp4 ? "mp4" : "webm"}`;
}

function makeVideo(base: string, dir: WalkDir, preload: "auto" | "metadata"): HTMLVideoElement {
  const v = document.createElement("video");
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.crossOrigin = "anonymous";
  v.preload = preload;
  v.loop = false;
  v.src = videoUrl(base, dir);
  return v;
}

/**
 * Phones and tablets get the 2560×1280 videos (half the bytes, loads twice as
 * fast; on a phone screen 4K shows hardly any more), computers the 4K ones.
 */
function wantsPhoneVideo(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches && Math.max(window.screen.width, window.screen.height) <= 1400;
  } catch {
    return false;
  }
}

/** A direction arrow (chevron), white on transparent (tinted by the material), pointing up. */
function drawArrow(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 96;
  const g = c.getContext("2d");
  if (!g) return c;
  g.strokeStyle = "#fff";
  g.lineWidth = 18;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.shadowColor = "rgba(255,255,255,0.9)";
  g.shadowBlur = 6;
  g.beginPath();
  g.moveTo(18, 78);
  g.lineTo(64, 22);
  g.lineTo(110, 78);
  g.stroke();
  return c;
}

export default function VideoWalk() {
  const hostRef = useRef<HTMLDivElement>(null);
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
  const [needsTap, setNeedsTap] = useState(() => needsTapToLoad());
  const [openRack, setOpenRack] = useState<ShowroomRack | null>(null);
  // the place being walked to (bar highlight); goRef starts a walk (set by the effect)
  const [goingTo, setGoingTo] = useState<string | null>(null);
  const goRef = useRef<(d: WalkDest) => void>(() => {});
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = !!openRack;
    if (openRack) stickRef.current = { x: 0, y: 0 };
  }, [openRack]);
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

    // one video + texture per part and direction (walkTrack.ts: parts)
    type Clip = { video: HTMLVideoElement; texture: VideoTexture };
    const phoneVideo = wantsPhoneVideo();
    const clips: Clip[][] = track.parts.map((part, i) =>
      (["fwd", "rev"] as WalkDir[]).map((d) => {
        const video = makeVideo(phoneVideo && part.mobileBase ? part.mobileBase : part.base, d, i === 0 && d === "fwd" ? "auto" : "metadata");
        const texture = new VideoTexture(video);
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = LinearFilter;
        texture.magFilter = LinearFilter;
        texture.generateMipmaps = false;
        return { video, texture };
      }),
    );
    const clip = (p: number, d: WalkDir) => clips[p][d === "fwd" ? 0 : 1];
    const allClips = clips.flat();
    const geometry = new SphereGeometry(SPHERE_R, 96, 64);
    geometry.scale(-1, 1, 1); // seen from inside, not mirrored
    const material = new MeshBasicMaterial({ map: clip(0, "fwd").texture });
    const NF = WALK_VIDEO.nadirFillDeg;
    // colour lift: unsharp mask on the video sample, then saturation +
    // vibrance + contrast + warmth on the final sRGB colour
    const texel = { value: new Vector2(1 / 3840, 1 / 1920) };
    const setTexel = (v: HTMLVideoElement) => {
      if (v.videoWidth > 0) texel.value.set(1 / v.videoWidth, 1 / v.videoHeight);
    };
    allClips.forEach(({ video }) => {
      if (video.readyState >= 1) setTexel(video);
      else video.addEventListener("loadedmetadata", () => setTexel(video), { once: true });
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.walkTexel = texel;
      const f = (n: number) => n.toFixed(3);
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform vec2 walkTexel;\nvoid main() {")
        .replace(
          "#include <map_fragment>",
          [
            "#ifdef USE_MAP",
            `  vec2 o = walkTexel * ${f(F.sharpenTexels)};`,
            "  vec4 s0 = texture2D( map, vMapUv );",
            "  vec4 sb = 0.25 * ( texture2D( map, vMapUv + vec2(o.x, 0.0) ) + texture2D( map, vMapUv - vec2(o.x, 0.0) )",
            "                   + texture2D( map, vMapUv + vec2(0.0, o.y) ) + texture2D( map, vMapUv - vec2(0.0, o.y) ) );",
            `  vec4 sampledDiffuseColor = clamp( s0 + (s0 - sb) * ${f(F.sharpen)}, 0.0, 1.0 );`,
            // nadir fill: below the cap use the floor just outside it, spread wider (blurrier) toward the pole
            `  float capV = ${f(NF / 180)};`,
            "  if ( vMapUv.y < capV + 0.02 ) {",
            "    float depth = clamp( (capV - vMapUv.y) / capV, 0.0, 1.0 );",
            // wide, soft average of the floor ring just outside the cap: near the
            // edge it follows the floor, toward the pole it melts into one tone
            "    float spread = 0.02 + 0.3 * depth * depth;",
            "    vec4 fill = vec4( 0.0 );",
            "    for ( int i = -4; i <= 4; i++ ) {",
            "      float fi = float( i ) / 4.0;",
            "      fill += texture2D( map, vec2( vMapUv.x + fi * spread, capV + 0.01 + 0.02 * abs( fi ) ) );",
            "    }",
            "    fill /= 9.0;",
            "    sampledDiffuseColor = mix( sampledDiffuseColor, fill, smoothstep( capV + 0.02, capV - 0.01, vMapUv.y ) );",
            "  }",
            "  #ifdef DECODE_VIDEO_TEXTURE",
            "  sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );",
            "  #endif",
            "  diffuseColor *= sampledDiffuseColor;",
            "#endif",
          ].join("\n"),
        )
        .replace(
          "#include <colorspace_fragment>",
          [
            "#include <colorspace_fragment>",
            `{ vec3 c = gl_FragColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));`,
            `  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));`,
            `  float k = ${f(F.saturation)} * (1.0 + ${f(F.vibrance)} * (1.0 - clamp(chroma * 2.5, 0.0, 1.0)));`,
            `  c = mix(vec3(l), c, k);`,
            `  c = (c - 0.5) * ${f(F.contrast)} + 0.5;`,
            `  c += vec3(${f(F.warmth)}, 0.0, ${f(-F.warmth)});`,
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
      if (img) {
        const frac = Math.tan((NL.logoWidthDeg / 2) * DEG) / Math.tan((NL.widthDeg / 2) * DEG);
        const d = 512 * frac;
        // a soft shadow under the logo so it reads on a light floor (no dark disc any more)
        const grad = g.createRadialGradient(256, 256, 0, 256, 256, d * 0.75);
        grad.addColorStop(0, "rgba(0,0,0,0.35)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 512, 512);
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
    const printTex = new CanvasTexture(drawArrow());
    printTex.colorSpace = SRGBColorSpace;
    const AR = F.arrows;
    const printGeo = new PlaneGeometry(AR.sizeM, AR.lenM);
    const printCount = Math.ceil(AR.lengthM / AR.spacingM) + 2;
    const BRANCH_PRINTS = 4; // arrows along the branch the view leans toward
    const prints: Mesh<PlaneGeometry, MeshBasicMaterial>[] = [];
    for (let i = 0; i < printCount + BRANCH_PRINTS; i++) {
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
      const fp = footprints(t, d, { startM: AR.startM, lengthM: AR.lengthM, strideM: AR.spacingM, footOffsetM: 0 }, track);
      // (no arrows for other ways: the walk to a place picks its own way)
      const bp: { x: number; z: number; hDeg: number; fade: number }[] = [];
      branchCount = bp.length;
      for (let i = 0; i < prints.length; i++) {
        const mesh = prints[i];
        if (i >= printCount) {
          const b = bp[i - printCount];
          if (!b) {
            mesh.visible = false;
            continue;
          }
          mesh.material.opacity = alpha * 0.85 * Math.max(0, b.fade);
          mesh.visible = mesh.material.opacity > 0.01;
          mesh.position.set(b.x, -ST.cameraHeightM, b.z);
          mesh.rotation.y = -b.hDeg * DEG;
          mesh.rotation.x = -Math.PI / 2;
          continue;
        }
        const p = fp[i];
        if (!p || alpha < 0.02) {
          mesh.visible = false;
          continue;
        }
        const near = Math.min(1, (p.r - AR.startM) / 0.35);
        const far = 1 - Math.pow((p.r - AR.startM) / AR.lengthM, 2);
        mesh.material.opacity = alpha * Math.max(0, near) * Math.max(0, far);
        mesh.visible = mesh.material.opacity > 0.01;
        mesh.position.set(p.x, -ST.cameraHeightM, p.z);
        mesh.rotation.y = -p.hDeg * DEG;
        mesh.rotation.x = -Math.PI / 2;
      }
    };
    let printAlpha = 0;
    let branchCount = 0; // prints of other ways shown (browser checks)
    let printDir: WalkDir = "fwd";

    // ── view state ─────────────────────────────────────────────────────────
    let yawDeg = headingAt(track.start); // facing the way the walk starts
    let pitchDeg: number = F.walkPitchDeg; // a little up: the cover under the visitor stays low on screen
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
    let part = 0; // index into track.parts of the clip on screen
    let playing = false;
    let rate = 0; // eased playback rate (0 = standing)
    let switching = false; // waiting for the other video to seek
    let jumping = false; // loop jump in progress
    let jumps = 0;
    let stepPhase = 0; // footfalls at whole numbers (distance / stride)
    let lastStepNo: number | null = null;
    let bobAmp = 0;
    let facing: Facing = "along";
    // ── walking to a place (autoWalk.ts) ────────────────────────────────────
    let route: RouteStep[] | null = null;
    let routeIdx = 0;
    let routeDest: WalkDest | null = null;
    // arrived: the view turns to the rack, then its sheet opens
    let arriving: { yaw: number; pitch: number; since: number; dest: WalkDest } | null = null;
    const reduceMotion = media("(prefers-reduced-motion: reduce)");
    let footIndex = 0;
    const active = () => clip(part, dir).video;
    const fwdTime = () => globalTime(active().currentTime, part, dir, track);
    let lastT: number | null = null; // forward time on the previous frame (junctions)

    const publish = () => {
      window.__walk = { t: fwdTime(), dir, part, playing, rate, yawDeg, pitchDeg, jumps, ready, branches: branchCount };
    };

    const safePlay = (v: HTMLVideoElement) => {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };
    const pauseAll = () => {
      allClips.forEach((c) => c.video.pause());
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

    /**
     * Before a step across on the route: the other pass's video gets seeked
     * there and paused (only when that is another video than the one
     * playing), so the jump can swap at once instead of waiting for a seek.
     */
    let primedVideo: HTMLVideoElement | null = null;
    let priming = false;
    let lastPrime = 0;
    const primeHop = (h: { t: number; dir: WalkDir }) => {
      if (priming || jumping || switching) return;
      const p2 = partIndexAt(h.t, h.dir, track);
      const v = clip(p2, h.dir).video;
      if (v === active() || v.readyState < 1) return;
      primedVideo = v;
      const want = localTime(h.t, p2, h.dir, track);
      if (Math.abs(v.currentTime - want) < 0.15) return;
      priming = true;
      void seekTo(v, want, 6000).then(() => {
        priming = false;
      });
    };

    /** Keep the idle video parked at the same moment, so a change of direction is instant. */
    let parking = false;
    let lastPark = 0;
    const parkIdle = () => {
      if (parking || switching || jumping) return;
      const idle: WalkDir = dir === "fwd" ? "rev" : "fwd";
      const v = clip(part, idle).video;
      if (primedVideo === v) return; // kept for the junction ahead
      if (v.readyState < 1) return;
      const want = localTime(fwdTime(), part, idle, track);
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
      for (const c of allClips) {
        const v = c.video;
        // the one shown keeps playing if a walk has started by then
        const keep = () => v === active() && playing;
        const p = v.play();
        if (p && typeof p.then === "function") p.then(() => (keep() ? undefined : v.pause())).catch(() => {});
        else if (!keep()) v.pause();
      }
    };

    // ── the frozen frame for jumps ──────────────────────────────────────────
    // The picture on screen is copied into a texture on the GPU (no read back
    // to the CPU — drawing the WebGL canvas into a 2D canvas stalled iPhones
    // for 100–170 ms per jump) and drawn on top while the new video gets
    // there; then it fades out and grows a little (reads as a step forward).
    const overlayScene = new Scene();
    const overlayCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const overlayMat = new ShaderMaterial({
      uniforms: { map: { value: null }, opacity: { value: 0 }, zoom: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      // the copy already holds output (sRGB) colours: shown as they are
      fragmentShader:
        "uniform sampler2D map; uniform float opacity; uniform float zoom; varying vec2 vUv;" +
        "void main() { vec2 uv = (vUv - 0.5) / zoom + 0.5; gl_FragColor = vec4(texture2D(map, uv).rgb, opacity); }",
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const overlayGeo = new PlaneGeometry(2, 2);
    overlayScene.add(new Mesh(overlayGeo, overlayMat));
    const bufSize = new Vector2();
    let frozenTex: FramebufferTexture | null = null;
    let frozenShown = false;
    let fadeStart = -1; // performance.now() when the fade began; −1 = holding
    const freezeFrame = (): boolean => {
      renderer.getDrawingBufferSize(bufSize);
      if (!bufSize.x || !bufSize.y) return false;
      if (!frozenTex || frozenTex.image.width !== bufSize.x || frozenTex.image.height !== bufSize.y) {
        frozenTex?.dispose();
        frozenTex = new FramebufferTexture(bufSize.x, bufSize.y);
      }
      renderer.copyFramebufferToTexture(frozenTex);
      overlayMat.uniforms.map.value = frozenTex;
      overlayMat.uniforms.opacity.value = 1;
      overlayMat.uniforms.zoom.value = 1;
      frozenShown = true;
      fadeStart = -1;
      return true;
    };
    const releaseFrame = () => {
      if (frozenShown) fadeStart = performance.now();
    };
    const drawFrozen = (now: number) => {
      if (!frozenShown) return;
      if (fadeStart >= 0) {
        const k = Math.min(1, (now - fadeStart) / F.loopFadeMs);
        const e = 1 - Math.pow(1 - k, 2); // ease-out
        overlayMat.uniforms.opacity.value = 1 - e;
        overlayMat.uniforms.zoom.value = 1 + (F.jumpZoom - 1) * e;
        if (k >= 1) {
          frozenShown = false;
          return;
        }
      }
      renderer.autoClear = false;
      renderer.render(overlayScene, overlayCam);
      renderer.autoClear = true;
    };
    let wantFreeze = false; // freeze right after the next render (the buffer is valid then)

    /**
     * Continue at forward time t (loop point, the next part, a junction):
     * the current frame is frozen on top, the clip for (t, newDir) seeks
     * there, then the frozen frame fades. yawShift turns the view with the
     * new pass's frame so the visitor keeps looking the same way.
     */
    const jumpTo = async (t: number, newDir: WalkDir = dir, yawShift = 0) => {
      jumping = true;
      wantFreeze = true;
      // stop the old clip right away (the frozen frame shows where it stood)
      const old = active();
      const wasPlaying = playing;
      old.pause();
      // wait for the render that captures the frozen frame
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      const p2 = partIndexAt(t, newDir, track);
      const c2 = clip(p2, newDir);
      const sameClip = p2 === part && newDir === dir;
      // primed before the junction: already there, swap at once; otherwise
      // seek (another clip may still have to download that spot on phones)
      const want = localTime(t, p2, newDir, track);
      const v2 = c2.video;
      const primed = !sameClip && !v2.seeking && v2.readyState >= 2 && Math.abs(v2.currentTime - want) < 0.2;
      const ok = primed || (await seekTo(v2, want, sameClip ? 1500 : 8000));
      primedVideo = null;
      if (disposed) return;
      if (ok || sameClip) {
        part = p2;
        dir = newDir;
        material.map = c2.texture;
        c2.texture.needsUpdate = true;
        yawDeg = normDeg(yawDeg + yawShift);
      }
      jumps++;
      lastStepNo = null;
      lastT = fwdTime();
      if (wasPlaying && rate > 0) safePlay(active());
      else playing = false;
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
      const p2 = partIndexAt(t, next, track);
      const to = clip(p2, next);
      const ok = await seekTo(to.video, localTime(t, p2, next, track), 5000);
      if (disposed) return;
      if (ok) {
        dir = next;
        part = p2;
        material.map = to.texture;
        to.texture.needsUpdate = true;
        lastT = fwdTime();
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
    const fv = clip(0, "fwd").video;
    const onReady = () => {
      if (ready || disposed) return;
      void seekTo(fv, localTime(track.start, 0, "fwd", track)).then(() => {
        if (disposed || ready) return;
        clip(0, "fwd").texture.needsUpdate = true;
        ready = true;
        setStatus("ready");
        publish();
        // back from the catalog or the constructor (or a reload): carry on
        // where the visitor was
        const saved = readResume();
        if (saved && Math.abs(saved.t - track.start) > 1) {
          yawDeg = saved.yawDeg;
          void jumpTo(saved.t, saved.dir);
        }
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
    }, 2500);
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
          `p${part} ${dir} rs=${v.readyState} ns=${v.networkState} err=${v.error?.code ?? "-"} t=${v.currentTime.toFixed(2)} buf=${b} paused=${v.paused} ${v.currentSrc.split("/").pop()}`,
        );
      }, 500);
    }
    fv.addEventListener("loadeddata", onReady);
    fv.addEventListener("canplay", onReady);
    fv.addEventListener("error", onError);
    if (fv.readyState >= 2) onReady();
    // preload the backward video once the forward one can play (the other
    // parts load when the walk gets there: they're big)
    const preloadRev = () => {
      const rv = clip(0, "rev").video;
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

    // ── walking to a place ─────────────────────────────────────────────────
    goRef.current = (d: WalkDest) => {
      unlockRef.current();
      if (!ready) return;
      const steps = planRoute(fwdTime(), d.t, track);
      if (!steps) return;
      route = steps;
      routeIdx = 0;
      routeDest = d;
      arriving = null;
      setGoingTo(d.id);
      setHintVisible(false);
    };
    const arrive = () => {
      const v = active();
      v.pause();
      playing = false;
      rate = 0;
      lastStepNo = null;
      if (routeDest) arriving = { yaw: routeDest.yawDeg, pitch: routeDest.pitchDeg ?? F.walkPitchDeg, since: performance.now(), dest: routeDest };
      route = null;
      routeDest = null;
      parkIdle();
    };

    // ── the frame loop ─────────────────────────────────────────────────────
    let turnRate = 0;
    let last = performance.now();
    let raf = 0;
    let lastPublish = 0;
    let lastSave = 0;
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
        const stick = sheetOpenRef.current ? { x: 0, y: 0 } : mergeSticks(stickRef.current, keysToStick(keys));
        // turning
        turnRate = easeToward(turnRate, turnRateFromStick(stick.x, { deadZone: F.turnDeadZone, maxTurnDegPerSec: F.turnMaxDegPerSec }), dt);
        if (Math.abs(stick.x) > F.turnDeadZone) lastTurnAt = now;
        if (Math.abs(turnRate) > 0.05) {
          yawDeg = normDeg(yawDeg + turnRate * (dt / 1000));
          setHintVisible(false);
        } else turnRate = 0;

        // walking to a place: the route's steps one after the other — walk in a
        // direction until a time, or step across to another pass at a crossing
        let target = 0;
        if (route && !switching) {
          const st = route[routeIdx];
          if (!st) arrive();
          else if (st.kind === "hop") {
            routeIdx++;
            facing = st.dir === "fwd" ? "along" : "against";
            printDir = st.dir;
            void jumpTo(st.t, st.dir, st.yawShift);
          } else {
            const t = fwdTime();
            if (reached(t, st.dir, st.until)) {
              routeIdx++;
              if (routeIdx >= route.length) arrive();
            } else if (st.dir !== dir) {
              facing = st.dir === "fwd" ? "along" : "against";
              void switchDir(st.dir);
            } else {
              facing = dir === "fwd" ? "along" : "against";
              printDir = dir;
              target = AUTO_RATE;
              // the step across coming next: get its video there in time
              const nx = route[routeIdx + 1];
              if (nx && nx.kind === "hop" && now - lastPrime > 250) {
                lastPrime = now;
                primeHop(nx);
              }
            }
          }
        }
        // arrived: turn to the rack, then open its sheet
        if (arriving) {
          const busy = pointers.size > 0 || now - lastDragAt < 400;
          if (!busy) {
            yawDeg = followStep(yawDeg, arriving.yaw, dt, { followMaxDegPerSec: 120, followEaseMs: 350 });
            pitchDeg = easeToward(pitchDeg, arriving.pitch, dt, F.pitchEaseMs);
          }
          const off = Math.max(Math.abs(angleDiff(arriving.yaw, yawDeg)), Math.abs(arriving.pitch - pitchDeg));
          if (off < 4 || busy || now - arriving.since > 2500) {
            const d = arriving.dest;
            arriving = null;
            setGoingTo(null);
            if (d.rack) setOpenRack(d.rack);
          }
        }
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
          // a few fixed speeds, changed only on a clear step: every change of
          // playbackRate makes Safari re-time the video (a visible hitch), and a
          // thumb on the stick moves all the time
          const r = target > 0 ? playbackStep(target, v.playbackRate) : v.playbackRate;
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
          const ps = track.parts;
          const next = loopJump(t, dir, track) ?? skipJump(t, dir, track);
          lastT = t;
          if (next !== null) {
            // the loop point, or across a stretch where the camera stood still
            void jumpTo(next);
          } else if (dir === "fwd" && part < ps.length - 1 && t >= ps[part].to - 0.02) {
            // into the next part's file
            void jumpTo(t, "fwd");
          } else if (dir === "rev" && part > 0 && t <= ps[part].from + 0.02) {
            void jumpTo(t, "rev");
          } else if ((dir === "fwd" && t >= track.duration - 0.1) || (dir === "rev" && t <= 0.1)) {
            // the very ends of the walk
            v.pause();
          }
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
      drawFrozen(now);
      if (now - lastPublish > 100) {
        lastPublish = now;
        publish();
      }
      if (ready && !jumping && now - lastSave > 1000) {
        lastSave = now;
        writeResume({ t: fwdTime(), dir, yawDeg });
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
      for (const c of allClips) {
        c.video.pause();
        c.video.removeAttribute("src");
        c.video.load();
        c.texture.dispose();
      }
      coverTex.dispose();
      frozenTex?.dispose();
      overlayMat.dispose();
      overlayGeo.dispose();
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

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101010] text-white">
          {/* iPhone: nothing loads before the tap, so no bar until then */}
          {!needsTap && (
            <>
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
            </>
          )}
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

      {openRack && <RackSheet rack={openRack} onClose={() => setOpenRack(null)} />}

      {status === "ready" && hintVisible && (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[16rem] rounded-lg bg-black/55 px-3 py-2 text-xs leading-snug text-white">
          {touch
            ? "აირჩიეთ საკიდი ქვემოთ — მიგიყვანთ. თითით გადაათრიეთ — მიმოხედვა."
            : "აირჩიეთ საკიდი ქვემოთ — მიგიყვანთ. მაუსით გადაათრიეთ — მიმოხედვა."}
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

      {status === "ready" && !openRack && (
        <nav
          aria-label="სად წავიდეთ"
          className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/70 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6"
        >
          <p className="px-4 pb-2 text-xs font-medium text-white/80">სად წავიდეთ?</p>
          {/* right padding: the sitewide chat button sits in the bottom-right corner */}
          <ul className="flex gap-2 overflow-x-auto pl-4 pr-20 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {dests.map((d) => (
              <li key={d.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    if (soundOn) ensureAudio();
                    goRef.current(d);
                  }}
                  aria-pressed={goingTo === d.id}
                  className={`rounded-full px-4 py-2 text-sm font-semibold shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    goingTo === d.id ? "bg-amber-400 text-black" : "bg-black/65 text-white ring-1 ring-amber-400/70 backdrop-blur-sm hover:bg-black/80"
                  }`}
                >
                  {d.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
