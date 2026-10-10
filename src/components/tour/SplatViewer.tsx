import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import Joystick from "./Joystick";
import { SCENE } from "@/lib/tour/sceneConfig";
import { clampStep, ensureInside, type Vec2 } from "@/lib/tour/walkBounds";
import {
  applyLook,
  easeVelocity,
  keysToStick,
  MAX_DT,
  targetVelocity,
  type StickInput,
} from "@/lib/tour/walkMotion";

// Walkable 3D showroom: a Gaussian-splat scan (Spark on three.js), walked in
// first person. three.js and Spark are imported HERE ONLY, and this file only
// from the lazy ShowroomPage, so none of it reaches the main bundle.
//
// CONTROLS
//   phone:   joystick bottom-left walks; dragging anywhere else looks around
//            (both at once with two fingers).
//   desktop: WASD / arrow keys walk; mouse drag looks around.
// The camera stays at eye height above the floor, moves only on the floor
// plane, never rolls, and looks at most ±60° up/down. Every step goes through
// clampStep, so the walker can't leave the walkable polygon (sceneConfig.ts).
//
// LAYERS: the wrapper is `isolate`, so everything here sits below the sitewide
// chat launcher (z-50); nothing is placed in the bottom-right corner.

const DEG = Math.PI / 180;
const MAX_DPR = 2;
/** Horizontal field of view the camera aims for; vertical is derived. */
const TARGET_HFOV_DEG = 80;

type Status = "loading" | "ready" | "error" | "nowebgl";

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

function prefersTouch(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  } catch {
    return false;
  }
}

/** Vertical FOV giving about TARGET_HFOV across, kept in a comfortable range. */
function verticalFovDeg(aspect: number): number {
  const v = (2 * Math.atan(Math.tan((TARGET_HFOV_DEG * DEG) / 2) / Math.max(aspect, 0.1))) / DEG;
  return Math.min(85, Math.max(50, v));
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

declare global {
  interface Window {
    /** Read-only camera pose, only with ?tourDebug=1 (used by browser checks). */
    __tourPose?: () => { x: number; z: number; yawDeg: number; pitchDeg: number; dpr: number };
  }
}

export default function SplatViewer() {
  const hostRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<StickInput>({ forward: 0, strafe: 0 });
  const [status, setStatus] = useState<Status>(() => (hasWebGL2() ? "loading" : "nowebgl"));
  const [progress, setProgress] = useState<number | null>(null);
  const [touch] = useState(prefersTouch);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status === "nowebgl") return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    } catch {
      setStatus("nowebgl");
      return;
    }
    let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR, isLowEndDevice() ? 1.5 : MAX_DPR);
    renderer.setPixelRatio(dpr);
    const canvas = renderer.domElement;
    canvas.className = "block h-full w-full touch-none select-none outline-none";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "ვირტუალური შოურუმი — 3D ხედი");
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101010");
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 600);
    camera.rotation.order = "YXZ"; // yaw, then pitch; roll stays 0

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);
    const mesh = new SplatMesh({
      url: SCENE.url,
      onProgress: (e) => {
        if (e.lengthComputable && e.total > 0) setProgress(Math.min(100, Math.round((100 * e.loaded) / e.total)));
      },
    });
    mesh.rotation.set(SCENE.orientationDeg.x * DEG, SCENE.orientationDeg.y * DEG, SCENE.orientationDeg.z * DEG);
    scene.add(mesh);
    let disposed = false;
    mesh.initialized
      .then(() => !disposed && setStatus("ready"))
      .catch(() => !disposed && setStatus("error"));

    // ── pose ────────────────────────────────────────────────────────────
    let pos: Vec2 = ensureInside([SCENE.start.x, SCENE.start.z], SCENE.walkable);
    let vel: Vec2 = [0, 0];
    let yaw = SCENE.start.yawDeg * DEG;
    let pitch = SCENE.start.pitchDeg * DEG;
    const pitchLimit = SCENE.pitchLimitDeg * DEG;
    const eyeY = SCENE.floorY + SCENE.eyeHeight;
    let moved = false;
    let hintShown = true;

    if (new URLSearchParams(window.location.search).get("tourDebug") === "1") {
      window.__tourPose = () => ({ x: pos[0], z: pos[1], yawDeg: yaw / DEG, pitchDeg: pitch / DEG, dpr });
    }

    // ── size ────────────────────────────────────────────────────────────
    const resize = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = verticalFovDeg(camera.aspect);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // ── keyboard ────────────────────────────────────────────────────────
    const keys = new Set<string>();
    const WALK_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.code) || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      keys.add(e.code);
      e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };
    const onBlur = () => keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // ── look (drag on the canvas; one pointer at a time) ────────────────
    let lookPointer: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const lookSpeed = () => ((camera.fov * DEG) / Math.max(1, host.clientHeight)) * 1.2;
    const onPointerDown = (e: PointerEvent) => {
      if (lookPointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      lookPointer = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== lookPointer) return;
      const next = applyLook(yaw, pitch, e.clientX - lastX, e.clientY - lastY, lookSpeed(), pitchLimit);
      yaw = next.yaw;
      pitch = next.pitch;
      lastX = e.clientX;
      lastY = e.clientY;
      moved = true;
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId === lookPointer) lookPointer = null;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("lostpointercapture", onPointerEnd);

    // Touch gestures belong to the camera: no page scroll, pinch-zoom or
    // pull-to-refresh while on the viewer.
    const stopTouch = (e: Event) => e.preventDefault();
    host.addEventListener("touchmove", stopTouch, { passive: false });
    host.addEventListener("gesturestart", stopTouch);
    const root = document.documentElement;
    const prevOverscroll = [root.style.overscrollBehavior, document.body.style.overscrollBehavior];
    root.style.overscrollBehavior = "none";
    document.body.style.overscrollBehavior = "none";

    // ── loop ────────────────────────────────────────────────────────────
    let last = performance.now();
    let frames = 0;
    let frameTime = 0;
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, MAX_DT);
      last = now;

      const stick = stickRef.current.forward || stickRef.current.strafe ? stickRef.current : keysToStick(keys);
      const target = targetVelocity(stick, yaw, SCENE.walkSpeed);
      vel = easeVelocity(vel, target, dt, SCENE.accelTime);
      if (vel[0] || vel[1]) {
        pos = clampStep(pos, [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt], SCENE.walkable);
        moved = true;
      }
      camera.position.set(pos[0], eyeY, pos[1]);
      camera.rotation.set(pitch, yaw, 0);
      renderer.render(scene, camera);

      // Keep motion smooth: step the resolution down on slow devices.
      frames++;
      frameTime += dt;
      if (frames >= 90) {
        if (frameTime / frames > 1 / 24 && dpr > 1) {
          dpr = Math.max(1, dpr - 0.25);
          renderer.setPixelRatio(dpr);
          resize();
        }
        frames = 0;
        frameTime = 0;
      }
      // The hint goes away for good on the first walk or look.
      if (moved && hintShown) {
        hintShown = false;
        setHintVisible(false);
      }
      moved = false;
    };
    renderer.setAnimationLoop(tick);
    const onVisibility = () => {
      if (document.hidden) {
        renderer.setAnimationLoop(null);
        keys.clear();
      } else {
        last = performance.now();
        renderer.setAnimationLoop(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      host.removeEventListener("touchmove", stopTouch);
      host.removeEventListener("gesturestart", stopTouch);
      root.style.overscrollBehavior = prevOverscroll[0];
      document.body.style.overscrollBehavior = prevOverscroll[1];
      ro.disconnect();
      delete window.__tourPose;
      scene.remove(mesh);
      mesh.dispose();
      spark.dispose();
      renderer.dispose();
      canvas.remove();
    };
    // status is read only to skip setup when WebGL2 is missing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "nowebgl") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[#101010] p-6 text-center text-sm text-white/90">
        <p className="max-w-sm">
          თქვენი ბრაუზერი 3D ხედს ვერ აჩვენებს — საჭიროა WebGL2. სცადეთ სხვა ბრაუზერი ან განაახლეთ არსებული.
        </p>
      </div>
    );
  }

  return (
    <div className="relative isolate h-full w-full overflow-hidden overscroll-none bg-[#101010]">
      <div ref={hostRef} className="absolute inset-0 touch-none" />

      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#101010]/80 text-white">
          <p className="text-sm font-medium" aria-live="polite">
            იტვირთება…{progress !== null ? ` ${progress}%` : ""}
          </p>
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-amber-400 transition-[width] duration-200"
              style={{ width: `${progress ?? 5}%` }}
            />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#101010]/90 p-6 text-center text-sm text-white">
          <p>სცენა ვერ ჩაიტვირთა. შეამოწმეთ ინტერნეტი და სცადეთ თავიდან.</p>
        </div>
      )}

      {status === "ready" && hintVisible && (
        <p className="pointer-events-none absolute left-3 top-3 z-20 max-w-[16rem] rounded-lg bg-black/55 px-3 py-2 text-xs leading-snug text-white">
          {touch
            ? "ჯოისტიკით — სიარული, თითით გადაათრიეთ — მიმოხედვა"
            : "WASD ან ისრები — სიარული, მაუსით გადაათრიეთ — მიმოხედვა"}
        </p>
      )}

      {touch && status === "ready" && (
        <Joystick
          onChange={(input) => {
            stickRef.current = input;
          }}
        />
      )}
    </div>
  );
}
