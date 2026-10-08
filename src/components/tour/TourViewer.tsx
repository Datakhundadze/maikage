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
import { nodePanoData, type TourLink, type TourNode } from "@/lib/tour/tourConfig";
import {
  clampToCoverage,
  coverageFromPanoData,
  maxVFovDeg,
  type TourCoverage,
} from "@/lib/tour/tourView";
import { WALK, easeInOutCubic, floorRingSquash, lerpYaw, phase } from "@/lib/tour/tourWalk";

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
// LINKS are flat rings on the floor (MarkersPlugin HTML markers), not the
// tour plugin's arrows. Clicking one runs the WALK (lib/tour/tourWalk.ts):
//   1. turn toward the ring, eyes level — every frame through rotate(), so the
//      clamp applies;
//   2. push forward: the FOV shrinks, overlapping the start of the fade;
//   3. cross-fade (tour plugin, camera still, no rotation). During the fade
//      both photos share one camera, so it must be valid for BOTH:
//        - zoom is capped for both photos (panorama-loaded fires before the
//          fade) and only ever shrinks while fading;
//        - the camera does not move while fading (no clamping, no rotate);
//        - the new photo is placed at its arrival position clamped for the
//          WIDER default FOV it will settle at, so it stays valid all the way;
//   4. settle: on the new photo, ease back out to its default zoom.
// prefers-reduced-motion: steps 1, 2 and 4 are skipped — a plain fade.

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

interface TourViewerProps {
  nodes: TourNode[];
  startNodeId: string;
}

export default function TourViewer({ nodes, startNodeId }: TourViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [webgl] = useState(hasWebGL);

  useEffect(() => {
    const container = containerRef.current;
    if (!webgl || !container) return;

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
      plugins: [MarkersPlugin, [VirtualTourPlugin, tourConfig]],
    });
    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    const reduceMotion = prefersReducedMotion();

    const linksByMarkerId = new Map<string, TourLink>();
    for (const node of nodes) node.links.forEach((link, i) => linksByMarkerId.set(linkMarkerId(node.id, i), link));

    // Coverage of the photo on screen; null = full sphere, nothing to clamp.
    let coverage: TourCoverage | null = null;
    // Coverage of the outgoing photo while a node change is fading.
    let fadingFrom: TourCoverage | null = null;
    let loadedOnce = false;
    // Mirror of the FOV limits last applied, to map FOV ↔ zoom level smoothly.
    let fovLimits = { min: MIN_FOV_DEG, max: 90 };
    let walking = false;
    let fading = false;
    // During a walk: the FOV the next photo settles at (its default zoom).
    let settleFov: number | null = null;
    let destroyed = false;

    // While fading, positions for the NEW photo are clamped for the FOV it
    // will settle at, so the same position stays valid as the zoom eases out.
    const clampFovFor = (vFov: number) => (fading && settleFov ? Math.max(vFov, settleFov) : vFov);

    const clampPosition = (position: Position, vFov = viewer.state.vFov): Position => {
      if (!coverage) return position;
      const f = clampFovFor(vFov);
      return clampToCoverage(position, f, viewer.dataHelper.vFovToHFov(f), coverage);
    };

    const moveIntoRange = () => {
      if (fading) return; // the camera holds still during a fade (see header)
      const current = viewer.getPosition();
      const ranged = clampPosition(current);
      if (Math.abs(ranged.yaw - current.yaw) > 1e-6 || Math.abs(ranged.pitch - current.pitch) > 1e-6) {
        viewer.rotate(ranged);
      }
    };

    const defaultFovFor = (c: TourCoverage | null) => {
      const max = maxVFovDeg(c, viewer.state.aspect);
      return (Math.min(MIN_FOV_DEG, max) + max) / 2; // zoom level 50
    };

    /** Zoom to an exact FOV (the library's own conversion rounds to whole levels). */
    const setFov = (fov: number) => {
      const span = fovLimits.max - fovLimits.min;
      const level = span > 0 ? ((fovLimits.max - fov) / span) * 100 : 0;
      viewer.zoom(Math.min(Math.max(level, 0), 100));
    };

    const applyZoomLimits = () => {
      const aspect = viewer.state.aspect;
      let maxFov = maxVFovDeg(coverage, aspect);
      if (fadingFrom) maxFov = Math.min(maxFov, maxVFovDeg(fadingFrom, aspect));
      const minFov = Math.min(MIN_FOV_DEG, maxFov);
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

    const walk = async (link: TourLink) => {
      if (walking || destroyed) return;
      walking = true;
      const arrive: Position = { yaw: (link.arriveYaw ?? 0) * DEG, pitch: 0 };
      const startFade = () => {
        fading = true;
        return tour.setCurrentNode(link.nodeId, {
          effect: "fade",
          speed: WALK.fadeMs,
          rotation: false,
          rotateTo: arrive,
          showLoader: false,
        });
      };
      try {
        if (reduceMotion) {
          await startFade();
        } else {
          const from = viewer.getPosition();
          // Face the ring with eyes level; the clamp keeps the view on photo.
          const goal = clampPosition({ yaw: link.yaw * DEG, pitch: 0 });
          const fov0 = viewer.state.vFov;
          const fovIn = Math.max(fovLimits.min, fov0 * WALK.zoomFactor);
          let fade: Promise<boolean> | null = null;
          await animate((ms) => {
            if (!fade) {
              const k = easeInOutCubic(phase(ms, 0, WALK.rotateMs));
              viewer.rotate({ yaw: lerpYaw(from.yaw, goal.yaw, k), pitch: from.pitch + (goal.pitch - from.pitch) * k });
              if (k >= 1) fade = startFade();
            }
            // Zooming IN only shrinks the view, so it is safe on either photo.
            setFov(fov0 + (fovIn - fov0) * easeInOutCubic(phase(ms, WALK.zoomStartMs, WALK.zoomMs)));
            return !fade || ms < WALK.zoomStartMs + WALK.zoomMs;
          });
          await fade;
        }
        // Settle on the new photo at its default zoom.
        fading = false;
        const target = settleFov;
        settleFov = null;
        if (target != null && !destroyed) {
          const fovFrom = viewer.state.vFov;
          if (reduceMotion) setFov(target);
          else
            await animate((ms) => {
              const k = easeInOutCubic(phase(ms, 0, WALK.settleMs));
              setFov(fovFrom + (target - fovFrom) * k);
              return k < 1;
            });
        }
      } catch {
        // aborted or failed load: stay where we are, usable
      } finally {
        fading = false;
        settleFov = null;
        walking = false;
        if (!destroyed) moveIntoRange();
      }
    };

    viewer.addEventListener("panorama-loaded", ({ data }) => {
      // Fired before the fade starts, so the limits are in place for it.
      fadingFrom = loadedOnce ? coverage : null;
      loadedOnce = true;
      coverage = coverageFromPanoData(data.panoData as PanoData | undefined);
      if (walking) settleFov = defaultFovFor(coverage);
      applyZoomLimits();
    });
    viewer.addEventListener("transition-done", () => {
      fadingFrom = null;
      fading = false;
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

    viewer.addEventListener("ready", () => {
      // Warm every photo so a walk never waits on the network.
      for (const node of nodes) viewer.textureLoader.preloadPanorama(node.panoramaUrl).catch(() => undefined);
    });

    markers.addEventListener("select-marker", ({ marker }) => {
      const link = linksByMarkerId.get(marker.id);
      if (link) void walk(link);
    });

    return () => {
      destroyed = true;
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

  return <div ref={containerRef} className="tour-viewer relative isolate h-full w-full bg-black" />;
}
