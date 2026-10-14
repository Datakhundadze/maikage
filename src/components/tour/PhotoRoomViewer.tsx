import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { Volume2, VolumeX } from "lucide-react";
import Joystick from "./Joystick";
import { buildPhotoRoom, loadRoomTextures, type PhotoRoom } from "./photoRoom";
import { SCENE, type RackId } from "@/lib/tour/sceneConfig";
import { buildWalkArea, usedImages } from "@/lib/tour/roomGeometry";
import { createFootsteps, type Footsteps } from "@/lib/tour/footsteps";
import { BOB_REST, bobOffset, stepBob, type BobOffset, type BobState } from "@/lib/tour/walkBob";
import { clampStep, closestOnArea, ensureInside, pointInArea, type Vec2 } from "@/lib/tour/walkBounds";
import {
  applyLook,
  easeTurnRate,
  easeVelocity,
  joystickToInput,
  keysToStick,
  MAX_DT,
  NO_INPUT,
  targetTurnRate,
  targetVelocity,
  type StickInput,
} from "@/lib/tour/walkMotion";

// Walkable 3D showroom: a box room built from photos of the shop (walls and
// rack billboards, photoRoom.ts), walked in first person. three.js is
// imported only by this file and photoRoom.ts, and they only from the lazy
// ShowroomPage, so none of it reaches the main bundle.
//
// CONTROLS
//   phone:   joystick bottom-left steers: up/down walks along the heading,
//            left/right turns (no strafing); dragging anywhere else looks
//            around (both at once with two fingers; the yaw inputs add).
//   desktop: W/S ↑/↓ walk, A/D ←/→ turn, Q/E strafe; mouse drag looks.
// The walker stays at eye height above the floor, moves only on the floor
// plane, and looks at most ±60° up/down. Every step goes through clampStep,
// so the walker can't leave the walkable area: the room minus a margin from
// the walls and around every rack (sceneConfig.ts → roomGeometry.ts).
//
// RACKS: each rack has an invisible pick volume. With a mouse, hovering one
// outlines it; a tap or click (press and release without dragging) selects
// it, and tapping it again clears the selection. `onRackSelect` reports the
// selection; phase 2 hangs the product cards on it.
//
// WALKING FEEL: a head bob (walkBob.ts) driven by the distance actually
// moved is added to the camera as an offset only; the logical position and
// the bounds clamp never see it. Reduced motion turns the bob off. Footstep
// thuds (footsteps.ts) play at each footfall once the visitor turns sound on
// with the speaker button; the AudioContext is created on that tap.
//
// LAYERS: the wrapper is `isolate`, so everything here sits below the sitewide
// chat launcher (z-50); nothing is placed in the bottom-right corner.

const DEG = Math.PI / 180;
const MAX_DPR = 2;
/** A press that moves less than this (px) and is shorter than TAP_MS is a tap. */
const TAP_PX = 8;
const TAP_MS = 500;
/** Horizontal field of view the camera aims for; vertical is derived. */
const TARGET_HFOV_DEG = 80;
const SOUND_KEY = "maika.showroom.sound";
const NO_BOB: BobOffset = { y: 0, lateral: 0, roll: 0 };

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

function prefersReducedMotion(): MediaQueryList | null {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)");
  } catch {
    return null;
  }
}

function loadSoundPref(): boolean {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

function saveSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // storage blocked (private mode etc.): the choice just isn't remembered
  }
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

declare global {
  interface Window {
    /** Read-only camera pose, only with ?tourDebug=1 (used by browser checks). */
    __tourPose?: () => {
      x: number;
      z: number;
      yawDeg: number;
      pitchDeg: number;
      dpr: number;
      /** Camera height (with bob) and the logical eye height, metres. */
      camY: number;
      eyeY: number;
      rollDeg: number;
      bobAmp: number;
      walked: number;
      footfalls: number;
      /** Footstep sounds actually played, and the audio state. */
      footstepsPlayed: number;
      audio: string;
      reducedMotion: boolean;
      /** Frames rendered so far, and seconds of motion integrated. */
      frame: number;
      simTime: number;
      turnRateDeg: number;
      /** Seconds of motion integrated while a turn input was held. */
      turnInputTime: number;
      /** Rack under the mouse, selected rack, and the outlined one. */
      hoverRack: RackId | null;
      selectedRack: RackId | null;
      highlightedRack: RackId | null;
      /** Photos loaded / needed. */
      textures: string;
      /** Position is walkable, and its distance to the nearest wall/rack margin, metres. */
      inBounds: boolean;
      clearance: number;
    };
  }
}

interface PhotoRoomViewerProps {
  /** Called when a rack is selected (tap/click) or the selection is cleared. */
  onRackSelect?: (id: RackId | null) => void;
}

export default function PhotoRoomViewer({ onRackSelect }: PhotoRoomViewerProps = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<StickInput>(NO_INPUT);
  const [status, setStatus] = useState<Status>(() => (hasWebGL2() ? "loading" : "nowebgl"));
  const [progress, setProgress] = useState<number | null>(null);
  const [touch] = useState(prefersTouch);
  const [hintVisible, setHintVisible] = useState(true);
  const [soundOn, setSoundOn] = useState(loadSoundPref);
  const soundOnRef = useRef(soundOn);
  const footstepsRef = useRef<Footsteps | null>(null);
  const onRackSelectRef = useRef(onRackSelect);
  onRackSelectRef.current = onRackSelect;

  // Creates the AudioContext; called only from a user gesture.
  const startAudio = () => {
    if (!footstepsRef.current) footstepsRef.current = createFootsteps(SCENE.footsteps);
    footstepsRef.current?.resume().catch(() => {});
  };

  const toggleSound = () => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    saveSoundPref(next);
    if (next) startAudio();
    else footstepsRef.current?.suspend().catch(() => {});
  };

  useEffect(
    () => () => {
      footstepsRef.current?.close().catch(() => {});
      footstepsRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host || status === "nowebgl") return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    } catch {
      setStatus("nowebgl");
      return;
    }
    // Phones and low-end machines get a lower pixel-ratio cap and smaller
    // photo textures (12 photos at 2048 px are ~200 MB of GPU memory).
    const lowEnd = touch || isLowEndDevice();
    const cheap = SCENE.lowEnd;
    let dpr = Math.min(window.devicePixelRatio || 1, lowEnd ? cheap.maxDpr : MAX_DPR);
    renderer.setPixelRatio(dpr);
    const canvas = renderer.domElement;
    canvas.className = "block h-full w-full touch-none select-none outline-none";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "ვირტუალური შოურუმი — 3D ხედი");
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#101010");
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 60);
    camera.rotation.order = "YXZ"; // yaw, then pitch; roll stays 0

    // ── room: preload every photo, then build ──────────────────────────
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const images = usedImages(SCENE);
    let room: PhotoRoom | null = null;
    let disposed = false;
    let texturesDone = 0;
    loadRoomTextures(images, lowEnd ? cheap.maxTextureSize : 4096, anisotropy, (done, total) => {
      texturesDone = done;
      if (!disposed) setProgress(Math.round((100 * done) / total));
    })
      .then((textures) => {
        if (disposed) {
          for (const t of textures.values()) t.dispose();
          return;
        }
        room = buildPhotoRoom(textures, anisotropy);
        scene.add(room.group);
        // upload everything now, not on the first frame that sees each wall
        renderer.compile(scene, camera);
        for (const t of textures.values()) renderer.initTexture(t);
        setStatus("ready");
        last = performance.now();
        renderer.setAnimationLoop(tick);
      })
      .catch(() => !disposed && setStatus("error"));

    // ── pose ────────────────────────────────────────────────────────────
    const walkArea = buildWalkArea(SCENE);
    let pos: Vec2 = ensureInside([SCENE.start.x, SCENE.start.z], walkArea);
    let vel: Vec2 = [0, 0];
    let turnRate = 0; // rad/s, eased
    let simTime = 0; // seconds of motion integrated (dt is capped per frame)
    let turnInputTime = 0; // of which a turn input was held (debug readout)
    let yaw = SCENE.start.yawDeg * DEG;
    let pitch = SCENE.start.pitchDeg * DEG;
    const pitchLimit = SCENE.pitchLimitDeg * DEG;
    const eyeY = SCENE.eyeHeight;
    let moved = false;
    let hintShown = true;
    let bob: BobState = BOB_REST;
    let footstepsPlayed = 0;
    let hoverRack: RackId | null = null;
    let selectedRack: RackId | null = null;
    /** Mouse position for hover picking (NDC), null when not over the canvas. */
    let hoverNdc: { x: number; y: number } | null = null;
    /** A tap waiting to be picked in the next frame (NDC). */
    let tapNdc: { x: number; y: number } | null = null;
    const raycaster = new THREE.Raycaster();
    const ndcVec = new THREE.Vector2();
    let frameCount = 0;
    const motionQuery = prefersReducedMotion();
    let reducedMotion = motionQuery?.matches ?? false;
    const onMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    motionQuery?.addEventListener?.("change", onMotionChange);

    if (new URLSearchParams(window.location.search).get("tourDebug") === "1") {
      window.__tourPose = () => ({
        x: pos[0],
        z: pos[1],
        yawDeg: yaw / DEG,
        pitchDeg: pitch / DEG,
        dpr,
        camY: camera.position.y,
        eyeY,
        rollDeg: -camera.rotation.z / DEG,
        bobAmp: bob.amp,
        walked: bob.distance,
        footfalls: bob.steps,
        footstepsPlayed,
        audio: footstepsRef.current?.state ?? "none",
        reducedMotion,
        frame: frameCount,
        simTime,
        turnRateDeg: turnRate / DEG,
        turnInputTime,
        hoverRack,
        selectedRack,
        highlightedRack: hoverRack ?? selectedRack,
        textures: `${texturesDone}/${images.length}`,
        inBounds: pointInArea(pos, walkArea),
        clearance: closestOnArea(pos, walkArea).distance,
      });
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

    // Sound remembered as on from an earlier visit: browsers only allow audio
    // after a gesture, so it starts with the visitor's first walk or look.
    const resumeRememberedSound = () => {
      if (soundOnRef.current && footstepsRef.current?.state !== "running") startAudio();
    };
    const onFirstGesture = () => resumeRememberedSound();
    const wrapper = host.parentElement;
    wrapper?.addEventListener("pointerdown", onFirstGesture);
    wrapper?.addEventListener("pointerup", onFirstGesture); // touch: audio unlocks on release

    // ── keyboard ────────────────────────────────────────────────────────
    const keys = new Set<string>();
    const WALK_KEYS = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ]);
    const onKeyDown = (e: KeyboardEvent) => {
      if (!WALK_KEYS.has(e.code) || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      keys.add(e.code);
      e.preventDefault();
      resumeRememberedSound();
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
    let downX = 0;
    let downY = 0;
    let downTime = 0;
    let dragged = false;
    const toNdc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
    };
    const lookSpeed = () => ((camera.fov * DEG) / Math.max(1, host.clientHeight)) * 1.2;
    const onPointerDown = (e: PointerEvent) => {
      if (lookPointer !== null || (e.pointerType === "mouse" && e.button !== 0)) return;
      lookPointer = e.pointerId;
      lastX = downX = e.clientX;
      lastY = downY = e.clientY;
      downTime = performance.now();
      dragged = false;
      canvas.setPointerCapture(e.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hoverNdc = toNdc(e);
      if (e.pointerId !== lookPointer) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > TAP_PX) dragged = true;
      const next = applyLook(yaw, pitch, e.clientX - lastX, e.clientY - lastY, lookSpeed(), pitchLimit);
      yaw = next.yaw;
      pitch = next.pitch;
      lastX = e.clientX;
      lastY = e.clientY;
      moved = true;
    };
    const onPointerEnd = (e: PointerEvent) => {
      if (e.pointerId !== lookPointer) return;
      lookPointer = null;
      if (e.type === "pointerup" && !dragged && performance.now() - downTime < TAP_MS) tapNdc = toNdc(e);
    };
    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") hoverNdc = null;
    };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("lostpointercapture", onPointerEnd);
    canvas.addEventListener("pointerleave", onPointerLeave);

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

      const joy = stickRef.current;
      const stick = joy.forward || joy.turn ? joy : keysToStick(keys);
      // turn first, so this frame's step already follows the new heading
      turnRate = easeTurnRate(
        turnRate,
        targetTurnRate(stick.turn, SCENE.steering.maxTurnRateDeg),
        dt,
        SCENE.steering.turnSmoothTime,
      );
      if (turnRate) {
        yaw += turnRate * dt;
        moved = true;
      }
      simTime += dt;
      if (stick.turn) turnInputTime += dt;
      const target = targetVelocity(stick, yaw, SCENE.walkSpeed);
      vel = easeVelocity(vel, target, dt, SCENE.accelTime);
      const from = pos;
      if (vel[0] || vel[1]) {
        pos = clampStep(pos, [pos[0] + vel[0] * dt, pos[1] + vel[1] * dt], walkArea);
        moved = true;
      }

      // Head bob + footsteps from the distance really moved (0 against a wall).
      const stepped = stepBob(bob, Math.hypot(pos[0] - from[0], pos[1] - from[1]), dt, SCENE.walkSpeed, SCENE.bob);
      bob = stepped.state;
      const steps = footstepsRef.current;
      if (soundOnRef.current && steps) {
        for (const foot of stepped.footfalls) {
          steps.play(foot, bob.amp);
          footstepsPlayed++;
        }
      }
      const off = reducedMotion ? NO_BOB : bobOffset(bob, SCENE.bob);
      // offset only: sway along the camera's right vector (cos yaw, −sin yaw)
      camera.position.set(pos[0] + Math.cos(yaw) * off.lateral, eyeY + off.y, pos[1] - Math.sin(yaw) * off.lateral);
      camera.rotation.set(pitch, yaw, -off.roll);
      camera.updateMatrixWorld();

      // Rack picking: hover (mouse) every frame, taps once.
      const built = room;
      if (built) {
        const pick = (ndc: { x: number; y: number }): RackId | null => {
          raycaster.setFromCamera(ndcVec.set(ndc.x, ndc.y), camera);
          const hit = raycaster.intersectObjects(built.pickables, false)[0];
          return (hit?.object.userData.rackId as RackId | undefined) ?? null;
        };
        const nextHover = hoverNdc && lookPointer === null ? pick(hoverNdc) : null;
        if (nextHover !== hoverRack) {
          hoverRack = nextHover;
          canvas.style.cursor = hoverRack ? "pointer" : "";
        }
        if (tapNdc) {
          const hit = pick(tapNdc);
          tapNdc = null;
          const next = hit === selectedRack ? null : hit;
          if (next !== selectedRack) {
            selectedRack = next;
            onRackSelectRef.current?.(selectedRack);
          }
        }
        built.setHighlight(hoverRack ?? selectedRack);
      }
      renderer.render(scene, camera);
      frameCount++;

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
    // the loop starts once the room is built (see the texture preload above)
    const onVisibility = () => {
      if (document.hidden) {
        renderer.setAnimationLoop(null);
        keys.clear();
      } else if (room) {
        last = performance.now();
        renderer.setAnimationLoop(tick);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", onVisibility);
      motionQuery?.removeEventListener?.("change", onMotionChange);
      wrapper?.removeEventListener("pointerdown", onFirstGesture);
      wrapper?.removeEventListener("pointerup", onFirstGesture);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      host.removeEventListener("touchmove", stopTouch);
      host.removeEventListener("gesturestart", stopTouch);
      root.style.overscrollBehavior = prevOverscroll[0];
      document.body.style.overscrollBehavior = prevOverscroll[1];
      ro.disconnect();
      delete window.__tourPose;
      if (room) {
        scene.remove(room.group);
        room.dispose();
      }
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
            შოურუმის ფოტოები იტვირთება…{progress !== null ? ` ${progress}%` : ""}
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
            ? "ჯოისტიკით — სიარული და მობრუნება, თითით გადაათრიეთ — მიმოხედვა"
            : "W/S — სიარული, A/D — მობრუნება, Q/E — გვერდით, მაუსით გადაათრიეთ — მიმოხედვა"}
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

      {touch && status === "ready" && (
        <Joystick
          onChange={(input) => {
            stickRef.current = joystickToInput(input, SCENE.steering.deadZone);
          }}
        />
      )}
    </div>
  );
}
