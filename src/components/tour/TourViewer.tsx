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
import { nodePanoData, type TourNode } from "@/lib/tour/tourConfig";
import {
  clampToCoverage,
  coverageFromPanoData,
  maxVFovDeg,
  type TourCoverage,
} from "@/lib/tour/tourView";

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
// Math lives in lib/tour/tourView.ts. While a node change fades, zoom is
// capped for BOTH photos, and the transition runs without camera rotation and
// lands on the centre of the new photo (yaw 0, pitch 0), so neither photo can
// show an edge during the fade.

/** Default narrowest FOV (deepest zoom), same as the library default. */
const MIN_FOV_DEG = 30;

const DEG = Math.PI / 180;

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

function toViewerNode(node: TourNode): VirtualTourNode {
  return {
    id: node.id,
    panorama: node.panoramaUrl,
    name: node.name_ka,
    caption: node.name_ka,
    panoData: nodePanoData(node),
    links: node.links.map((l) => ({
      nodeId: l.nodeId,
      position: { yaw: l.yaw * DEG, pitch: l.pitch * DEG },
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
      nodes: nodes.map(toViewerNode),
      startNodeId,
      preload: true,
      // Fade only, camera still; the new photo opens at its centre.
      // (Callback form: only it may set rotateTo; the rest keeps the defaults.)
      transitionOptions: () => ({ rotation: false, rotateTo: { yaw: 0, pitch: 0 } }),
    };

    const viewer = new Viewer({
      container,
      lang: LANG_KA,
      loadingTxt: LANG_KA.loading,
      navbar: ["zoom", "caption", "fullscreen"],
      plugins: [MarkersPlugin, [VirtualTourPlugin, tourConfig]],
    });

    // Coverage of the photo on screen; null = full sphere, nothing to clamp.
    let coverage: TourCoverage | null = null;
    // Coverage of the outgoing photo while a node change is fading.
    let fadingFrom: TourCoverage | null = null;
    let loadedOnce = false;

    const clampPosition = (position: Position, vFov = viewer.state.vFov): Position =>
      coverage
        ? clampToCoverage(position, vFov, viewer.dataHelper.vFovToHFov(vFov), coverage)
        : position;

    const moveIntoRange = () => {
      const current = viewer.getPosition();
      const ranged = clampPosition(current);
      if (Math.abs(ranged.yaw - current.yaw) > 1e-6 || Math.abs(ranged.pitch - current.pitch) > 1e-6) {
        viewer.rotate(ranged);
      }
    };

    const applyZoomLimits = () => {
      const aspect = viewer.state.aspect;
      let maxFov = maxVFovDeg(coverage, aspect);
      if (fadingFrom) maxFov = Math.min(maxFov, maxVFovDeg(fadingFrom, aspect));
      const minFov = Math.min(MIN_FOV_DEG, maxFov);
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

    viewer.addEventListener("panorama-loaded", ({ data }) => {
      // Fired before the fade starts, so the limits are in place for it.
      fadingFrom = loadedOnce ? coverage : null;
      loadedOnce = true;
      coverage = coverageFromPanoData(data.panoData as PanoData | undefined);
      applyZoomLimits();
    });
    viewer.addEventListener("transition-done", () => {
      fadingFrom = null;
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

    return () => viewer.destroy();
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
