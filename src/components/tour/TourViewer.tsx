import { useEffect, useRef, useState } from "react";
import { Viewer, type PanoData, type Position } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import {
  VirtualTourPlugin,
  type VirtualTourNode,
  type VirtualTourPluginConfig,
} from "@photo-sphere-viewer/virtual-tour-plugin";
import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";
import "./tourViewer.css";
import {
  TOUR_EYE_PITCH_DEG,
  nodePanoData,
  partialPanoData,
  type TourLink,
  type TourNode,
} from "@/lib/tour/tourConfig";
import {
  clampToCoverage,
  coverageFromPanoData,
  maxVFovDeg,
  type TourCoverage,
} from "@/lib/tour/tourView";
import {
  WALK,
  easeInOutCubic,
  floorRingSquash,
  lerpYaw,
  magnifiedFovDeg,
  phase,
} from "@/lib/tour/tourWalk";

// 360° tour viewer for /showroom. Photo Sphere Viewer and its CSS are imported
// HERE ONLY (and this file only from the lazy ShowroomPage), so three.js and
// the viewer stay in the /showroom chunk and never reach the main bundle.
//
// STACKING: the wrapper is `isolate`, so every z-index the viewer uses
// internally (up to 9999) is contained inside it and the whole tour sits below
// the sitewide chat launcher (z-50). The navbar is also kept clear of the
// launcher's corner (tourViewer.css).
//
// NO BLACK OUTSIDE THE PHOTO. Partial panoramas cover only part of the sphere.
// For the node on screen we derive its coverage from the crop data once the
// image has loaded, then
//   - cap zoom-out (maxFov) at the widest FOV whose viewport still fits the
//     photo — recomputed when the viewer is resized (aspect changes it);
//   - clamp every camera move (drag, inertia, animation, zoom) to the nearest
//     position whose whole viewport, corners included, is photo.
// Math lives in lib/tour/tourView.ts.
//
// WALK (lib/tour/tourWalk.ts). Links are flat rings on the floor. Tapping one:
//   1. turns toward the ring if it is off-centre and pushes in on this photo
//      by the link's walkZoom — every frame through rotate()/zoom(), clamped;
//   2. takes a SNAPSHOT of that last frame into an overlay canvas above the
//      photo (below the rings and navbar);
//   3. switches node instantly underneath, at default zoom, facing arriveYaw;
//   4. fades the snapshot out (still scaling up a little: forward motion).
// The cross-fade has to be done this way: with one camera, "this photo zoomed
// in" and "the next photo at default zoom" cannot both be on screen at once.
// No black at any frame: the snapshot is a copy of a clamped frame and only
// scales up while it is opaque enough to matter; the live viewer underneath is
// always clamped.
// BACK („← უკან") is the reverse: snapshot, switch to the previous photo
// zoomed in by the same walkZoom on the counter, fade out while easing out.
// prefers-reduced-motion: snapshot cross-fade only, no turn or zoom.

/** Default narrowest FOV (deepest zoom), same as the library default. */
const MIN_FOV_DEG = 30;

const DEG = Math.PI / 180;

/** Marker box (CSS px): at least 44 × 44 so the ring is easy to tap. */
const RING_BOX = { width: 112, height: 64 };

// Viewer UI strings in Georgian (same keys as the library's English defaults).
const LANG_KA: Record<string, string> = {
  zoom: "მასშტაბი",
  zoomOut: "დაშორება",
  zoomIn: "მიახლოება",
  moveUp: "ზემოთ",
  moveDown: "ქვემოთ",
  moveLeft: "მარცხნივ",
  moveRight: "მარჯვნივ",
  description: "აღწერა",
  download: "ჩამოტვირთვა",
  fullscreen: "სრულ ეკრანზე",
  loading: "იტვირთება…",
  menu: "მენიუ",
  close: "დახურვა",
  twoFingers: "გადასაადგილებლად გამოიყენეთ ორი თითი",
  ctrlZoom: "მასშტაბისთვის გამოიყენეთ Ctrl + სქროლი",
  loadError: "პანორამა ვერ ჩაიტვირთა",
  webglError: "თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს",
};

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const linkMarkerId = (nodeId: string, index: number) => `tour-link:${nodeId}:${index}`;

/** A white ring lying on the floor, squashed by the viewing angle. */
function floorRingHtml(link: TourLink, targetName: string): string {
  const label = escapeHtml(`გადასვლა: ${targetName}`);
  const squash = floorRingSquash(link.pitch).toFixed(3);
  return (
    `<div class="tour-floor-ring" style="--tour-ring-squash:${squash}" role="button" aria-label="${label}" title="${label}">` +
    `<span class="tour-floor-ring__pulse"></span><span class="tour-floor-ring__ring"></span></div>`
  );
}

function toViewerNode(node: TourNode, nodes: TourNode[]): VirtualTourNode {
  return {
    id: node.id,
    panorama: node.panoramaUrl,
    name: node.name_ka,
    caption: node.name_ka,
    panoData: nodePanoData(node),
    // Navigation runs through our floor rings and walk, not plugin arrows.
    links: [],
    markers: node.links.map((link, i) => ({
      id: linkMarkerId(node.id, i),
      position: { yaw: link.yaw * DEG, pitch: link.pitch * DEG },
      html: floorRingHtml(link, nodes.find((n) => n.id === link.nodeId)?.name_ka ?? ""),
      size: RING_BOX,
      anchor: "center center",
    })),
  };
}

/** The node that links forward to `nodeId`, and that link (for „უკან"). */
function previousOf(nodes: TourNode[], nodeId: string): { node: TourNode; link: TourLink } | null {
  for (const node of nodes) {
    const link = node.links.find((l) => l.nodeId === nodeId);
    if (link) return { node, link };
  }
  return null;
}

interface TourViewerProps {
  nodes: TourNode[];
  startNodeId: string;
}

export default function TourViewer({ nodes, startNodeId }: TourViewerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const goBackRef = useRef<() => void>(() => {});
  const [webgl] = useState(hasWebGL);
  const [currentId, setCurrentId] = useState(startNodeId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!webgl || !wrapper || !container || !overlay) return;

    const tourConfig: VirtualTourPluginConfig = {
      positionMode: "manual",
      renderMode: "2d",
      nodes: nodes.map((n) => toViewerNode(n, nodes)),
      startNodeId,
    };

    const viewer = new Viewer({
      container,
      lang: LANG_KA,
      loadingTxt: LANG_KA.loading,
      navbar: ["zoom", "caption", "fullscreen"],
      defaultPitch: TOUR_EYE_PITCH_DEG * DEG,
      plugins: [MarkersPlugin, [VirtualTourPlugin, tourConfig]],
    });
    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    const reduceMotion = prefersReducedMotion();

    const linksByMarkerId = new Map<string, TourLink>();
    for (const node of nodes) node.links.forEach((link, i) => linksByMarkerId.set(linkMarkerId(node.id, i), link));

    // Coverage of the photo on screen; null = full sphere, nothing to clamp.
    let coverage: TourCoverage | null = null;
    // Mirror of the FOV limits last applied, to map FOV ↔ zoom level smoothly.
    let fovLimits = { min: MIN_FOV_DEG, max: 90 };
    // A walk may zoom deeper than the normal limit; lowered only while it runs.
    let minFovOverride: number | null = null;
    let walking = false;
    let destroyed = false;
    let currentNodeId = startNodeId;
    // Pixel size of every photo, from our own preload: lets a walk know the
    // NEXT photo's coverage (and so its default zoom) before switching.
    const imageSizes = new Map<string, { width: number; height: number }>();

    const clampPosition = (position: Position, vFov = viewer.state.vFov): Position =>
      coverage ? clampToCoverage(position, vFov, viewer.dataHelper.vFovToHFov(vFov), coverage) : position;

    const moveIntoRange = () => {
      const current = viewer.getPosition();
      const ranged = clampPosition(current);
      if (Math.abs(ranged.yaw - current.yaw) > 1e-6 || Math.abs(ranged.pitch - current.pitch) > 1e-6) {
        viewer.rotate(ranged);
      }
    };

    const coverageOf = (node: TourNode): TourCoverage | null => {
      const size = imageSizes.get(node.id);
      if (!size || node.horizontalFovDeg == null) return null;
      return coverageFromPanoData(partialPanoData(node.horizontalFovDeg)(size as HTMLImageElement));
    };

    /** Default zoom (level 50) for a coverage at the current viewer aspect. */
    const defaultFovFor = (c: TourCoverage | null) => {
      const max = maxVFovDeg(c, viewer.state.aspect);
      return (Math.min(MIN_FOV_DEG, max) + max) / 2;
    };

    /** Zoom to an exact FOV (the library's own conversion rounds to whole levels). */
    const setFov = (fov: number) => {
      const span = fovLimits.max - fovLimits.min;
      const level = span > 0 ? ((fovLimits.max - fov) / span) * 100 : 0;
      viewer.zoom(Math.min(Math.max(level, 0), 100));
    };

    const applyZoomLimits = () => {
      const maxFov = maxVFovDeg(coverage, viewer.state.aspect);
      const minFov = Math.min(MIN_FOV_DEG, maxFov, minFovOverride ?? Infinity);
      fovLimits = { min: minFov, max: maxFov };
      // Setting fov limits re-derives the zoom level from the current FOV.
      viewer.setOptions({ minFov, maxFov });
      // …but when that level is already at its end stop (fully zoomed out =
      // 0) the library sees no change and leaves the old, too-wide FOV on
      // screen. Nudge the level so the FOV is recomputed within the new limits.
      const vFov = viewer.state.vFov;
      if (vFov > maxFov + 1e-3 || vFov < minFov - 1e-3) {
        const level = viewer.getZoomLevel();
        viewer.zoom(level > 50 ? level - 0.01 : level + 0.01);
        viewer.zoom(level);
      }
      moveIntoRange();
    };

    /** Runs `frame(elapsedMs)` every animation frame until it returns false. */
    const animate = (frame: (elapsedMs: number) => boolean) =>
      new Promise<void>((resolve) => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (destroyed || !frame(now - t0)) return resolve();
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

    /** Resolves right after the viewer's next render (forcing one). */
    const nextRender = () =>
      new Promise<void>((resolve) => {
        const onRender = () => {
          viewer.removeEventListener("render", onRender);
          resolve();
        };
        viewer.addEventListener("render", onRender);
        viewer.needsUpdate();
      });

    /** Copies the frame on screen into the overlay and shows it. */
    const snapshot = async () => {
      const source = container.querySelector<HTMLCanvasElement>(".psv-canvas-container canvas") ?? container.querySelector("canvas");
      const ctx = overlay.getContext("2d");
      if (!source || !ctx) return false;
      // Read the WebGL canvas in the same task as a render, before the browser
      // clears its drawing buffer.
      await new Promise<void>((resolve) => {
        const onRender = () => {
          viewer.removeEventListener("render", onRender);
          overlay.width = source.width;
          overlay.height = source.height;
          ctx.drawImage(source, 0, 0);
          resolve();
        };
        viewer.addEventListener("render", onRender);
        viewer.needsUpdate();
      });
      overlay.style.transform = "scale(1)";
      overlay.style.opacity = "1";
      overlay.style.visibility = "visible";
      return true;
    };

    const fadeOutSnapshot = (toScale: number, alongside?: (k: number) => void, durationMs: number = WALK.fadeMs) =>
      animate((ms) => {
        const k = easeInOutCubic(phase(ms, 0, durationMs));
        overlay.style.opacity = String(1 - k);
        overlay.style.transform = `scale(${1 + (toScale - 1) * k})`;
        alongside?.(k);
        return k < 1;
      }).then(() => {
        overlay.style.visibility = "hidden";
      });

    /** Switches node instantly (under the snapshot) and sets the view there. */
    const switchTo = async (nodeId: string, view: Position, fov: number) => {
      await tour.setCurrentNode(nodeId, { effect: "none", rotation: false, rotateTo: view, showLoader: false });
      // panorama-loaded has applied the new photo's limits by now
      setFov(fov);
      viewer.rotate(view);
      await nextRender();
    };

    const setWalking = (on: boolean) => {
      walking = on;
      wrapper.classList.toggle("tour-walking", on);
      setBusy(on);
    };

    const finishWalk = () => {
      if (destroyed) return;
      minFovOverride = null;
      applyZoomLimits();
      setWalking(false);
    };

    const walk = async (link: TourLink) => {
      if (walking || destroyed) return;
      const target = nodes.find((n) => n.id === link.nodeId);
      if (!target) return;
      setWalking(true);
      try {
        const eye = TOUR_EYE_PITCH_DEG * DEG;
        const arrive: Position = { yaw: (link.arriveYaw ?? 0) * DEG, pitch: eye };
        const targetDefaultFov = defaultFovFor(coverageOf(target) ?? coverage);

        if (!reduceMotion) {
          const m = link.walkZoom ?? WALK.defaultWalkZoom;
          // End of the push-in: the counter about as big as in the next photo.
          const fovEnd = Math.min(viewer.state.vFov, magnifiedFovDeg(targetDefaultFov, m));
          if (fovEnd < fovLimits.min) {
            minFovOverride = fovEnd;
            applyZoomLimits();
          }
          const from = viewer.getPosition();
          const goal = clampPosition({ yaw: link.yaw * DEG, pitch: eye }, fovEnd);
          const needTurn = Math.abs(lerpYaw(from.yaw, goal.yaw, 1) - from.yaw) > WALK.turnThresholdDeg * DEG || Math.abs(goal.pitch - from.pitch) > WALK.turnThresholdDeg * DEG;
          const turnMs = needTurn ? WALK.turnMs : 0;
          const fov0 = viewer.state.vFov;
          await animate((ms) => {
            const kt = easeInOutCubic(phase(ms, 0, turnMs));
            viewer.rotate({ yaw: lerpYaw(from.yaw, goal.yaw, kt), pitch: from.pitch + (goal.pitch - from.pitch) * kt });
            // Zooming IN only shrinks the view, so it never shows an edge.
            setFov(fov0 + (fovEnd - fov0) * easeInOutCubic(phase(ms, WALK.zoomStartMs, WALK.zoomMs)));
            return ms < Math.max(turnMs, WALK.zoomStartMs + WALK.zoomMs);
          });
        }

        const shot = await snapshot();
        minFovOverride = null;
        await switchTo(target.id, arrive, targetDefaultFov);
        if (shot) await fadeOutSnapshot(reduceMotion ? 1 : WALK.fadeScaleForward);
      } catch {
        overlay.style.visibility = "hidden"; // aborted or failed load: stay usable
      } finally {
        finishWalk();
      }
    };

    const goBack = async () => {
      if (walking || destroyed) return;
      const prev = previousOf(nodes, currentNodeId);
      if (!prev) return;
      setWalking(true);
      try {
        const view: Position = { yaw: prev.link.yaw * DEG, pitch: TOUR_EYE_PITCH_DEG * DEG };
        const prevDefaultFov = defaultFovFor(coverageOf(prev.node) ?? coverage);
        const fovStart = reduceMotion
          ? prevDefaultFov
          : magnifiedFovDeg(prevDefaultFov, prev.link.walkZoom ?? WALK.defaultWalkZoom);
        const shot = await snapshot();
        if (fovStart < MIN_FOV_DEG) minFovOverride = fovStart;
        await switchTo(prev.node.id, view, fovStart);
        if (shot) {
          await fadeOutSnapshot(
            reduceMotion ? 1 : WALK.fadeScaleBack,
            // Zooming OUT is clamped every frame (zoom-updated → moveIntoRange).
            reduceMotion ? undefined : (k) => setFov(fovStart + (prevDefaultFov - fovStart) * k),
            reduceMotion ? WALK.fadeMs : WALK.backZoomMs,
          );
        }
        if (!reduceMotion) setFov(prevDefaultFov);
      } catch {
        overlay.style.visibility = "hidden";
      } finally {
        finishWalk();
      }
    };
    goBackRef.current = () => void goBack();

    viewer.addEventListener("panorama-loaded", ({ data }) => {
      coverage = coverageFromPanoData(data.panoData as PanoData | undefined);
      applyZoomLimits();
    });
    viewer.addEventListener("size-updated", applyZoomLimits);
    viewer.addEventListener("before-rotate", (e) => {
      e.position = clampPosition(e.position);
    });
    viewer.addEventListener("before-animate", (e) => {
      if (!e.position) return;
      const vFov = e.zoomLevel != null ? viewer.dataHelper.zoomLevelToFov(e.zoomLevel) : viewer.state.vFov;
      e.position = clampPosition(e.position, vFov);
    });
    // Inertia after a drag moves the camera without before-rotate.
    viewer.addEventListener("position-updated", moveIntoRange);
    viewer.addEventListener("zoom-updated", moveIntoRange);

    tour.addEventListener("node-changed", ({ node }) => {
      currentNodeId = node.id;
      setCurrentId(node.id);
    });

    viewer.addEventListener("ready", () => {
      // Preload every photo (three small files: all of them are neighbours)
      // into the viewer's cache, and read their sizes for the walk maths.
      for (const node of nodes) {
        viewer.textureLoader.preloadPanorama(node.panoramaUrl).catch(() => undefined);
        const img = new Image();
        img.onload = () => imageSizes.set(node.id, { width: img.naturalWidth, height: img.naturalHeight });
        img.src = node.panoramaUrl;
      }
    });

    markers.addEventListener("select-marker", ({ marker }) => {
      const link = linksByMarkerId.get(marker.id);
      if (link) void walk(link);
    });

    return () => {
      destroyed = true;
      goBackRef.current = () => {};
      viewer.destroy();
    };
  }, [webgl, nodes, startNodeId]);

  if (!webgl) {
    const start = nodes.find((n) => n.id === startNodeId) ?? nodes[0];
    return (
      <div className="tour-viewer relative isolate flex h-full w-full flex-col bg-black">
        {start && (
          <img
            src={start.panoramaUrl}
            alt={start.name_ka}
            className="min-h-0 w-full flex-1 object-cover"
          />
        )}
        {/* pr-24 keeps the text clear of the chat launcher's corner */}
        <p className="bg-black/80 py-3 pl-4 pr-24 text-sm text-white">
          თქვენი ბრაუზერი 360° ხედს ვერ აჩვენებს — ნაჩვენებია ჩვეულებრივი ფოტო.
        </p>
      </div>
    );
  }

  const canGoBack = previousOf(nodes, currentId) !== null;

  return (
    <div ref={wrapperRef} className="tour-viewer relative isolate h-full w-full overflow-hidden bg-black">
      <div ref={containerRef} className="absolute inset-0" />
      {/* Walk snapshot: above the photo (z 0), below the rings (z 10+). */}
      <canvas
        ref={overlayRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] h-full w-full origin-center"
        style={{ visibility: "hidden" }}
      />
      {canGoBack && (
        <button
          type="button"
          onClick={() => goBackRef.current()}
          disabled={busy}
          className="absolute left-3 top-3 z-[40] inline-flex min-h-11 min-w-11 items-center justify-center rounded-full bg-black/55 px-4 text-sm font-medium text-white shadow-lg backdrop-blur-sm transition-opacity hover:bg-black/70 disabled:opacity-60"
        >
          ← უკან
        </button>
      )}
    </div>
  );
}
