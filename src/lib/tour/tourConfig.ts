// Static configuration for the /showroom virtual tour (phase 1).
//
// Only imported from the lazy /showroom tree (ShowroomPage → TourViewer), so
// nothing here reaches the main bundle. The Photo Sphere Viewer import below is
// type-only and is erased at build time.
//
// PANORAMAS
//   panoramaUrl is used AS IS — a path under public/ for the placeholders, a
//   Supabase public-storage URL for the real shots. Never run it through
//   transformedDisplayUrl: the render endpoint caps output size and would blur
//   a multi-thousand-pixel panorama.
//
// ANGLES are in DEGREES. yaw 0 is the centre of the image, positive to the
// right; pitch 0 is the horizon, positive up. TourViewer converts to radians.

import type { PanoData, PanoDataProvider } from "@photo-sphere-viewer/core";

export interface TourLink {
  /** id of the node this link leads to */
  nodeId: string;
  /**
   * Where the floor ring sits in THIS panorama, degrees. yaw must lie inside
   * this node's horizontal coverage; pitch is below the horizon, on the floor.
   */
  yaw: number;
  pitch: number;
  /**
   * Direction the visitor faces on arrival in the TARGET panorama (direction
   * of travel), degrees. Default 0 = centre of the photo. Clamped to coverage.
   */
  arriveYaw?: number;
  /**
   * Forward-motion magnification for the walk: this photo zooms in by this
   * factor (on the tangent of the half-FOV, i.e. on-screen size) so the
   * subject ends the zoom at about the size it has in the TARGET photo at
   * default zoom; then the two cross-fade. Going back runs the reverse.
   * Default 1.4.
   */
  walkZoom?: number;
}

export interface TourNode {
  id: string;
  /** Georgian label: navbar caption and the floor ring's label */
  name_ka: string;
  panoramaUrl: string;
  /**
   * How many degrees the photo spans left to right. Omit for a full 360°
   * equirectangular sphere. For a partial / cylindrical shot (iPhone Pano)
   * set this; the vertical span follows from the image aspect ratio
   * (partialPanoData), and TourViewer keeps the camera inside both.
   */
  horizontalFovDeg?: number;
  /** Explicit crop data; wins over horizontalFovDeg when both are set. */
  panoData?: PanoData | PanoDataProvider;
  /** Every link's yaw must lie inside this node's horizontal coverage. */
  links: TourLink[];
}

/**
 * Crop data for a panorama that covers `horizontalFovDeg` degrees across and
 * whatever its aspect ratio implies vertically, centred on the horizon — the
 * shape an iPhone Pano produces. Computed from the loaded image, so the same
 * config works whatever resolution the shot is exported at.
 *
 * If the file carries GPano XMP crop data, that wins: it is exact, this is an
 * assumption (horizon in the middle of the frame).
 */
export function partialPanoData(horizontalFovDeg = 360): PanoDataProvider {
  const fov = Math.min(Math.max(horizontalFovDeg, 1), 360);
  return (image, xmpData) => {
    if (xmpData?.fullWidth) return xmpData;
    const fullWidth = Math.round((image.width * 360) / fov);
    const fullHeight = Math.round(fullWidth / 2);
    const croppedHeight = Math.min(image.height, fullHeight);
    return {
      fullWidth,
      fullHeight,
      croppedWidth: image.width,
      croppedHeight,
      croppedX: Math.round((fullWidth - image.width) / 2),
      croppedY: Math.round((fullHeight - croppedHeight) / 2),
    };
  };
}

/** Crop data for a node: explicit panoData, else derived from horizontalFovDeg. */
export function nodePanoData(node: TourNode): PanoData | PanoDataProvider | undefined {
  if (node.panoData) return node.panoData;
  return node.horizontalFovDeg != null ? partialPanoData(node.horizontalFovDeg) : undefined;
}

/**
 * Default look-down for every view, degrees (clamped to the photo). Eyes a
 * little below the horizon keep the floor — and the floor rings — in view.
 */
export const TOUR_EYE_PITCH_DEG = -7;

// A 3-step walk from the entrance to the counter: iPhone Pano shots taken on
// one line toward the counter, each closer. The JPEGs in public/tour/ are
// reprojected from the phone's cylindrical output to equirectangular at a 62°
// true vertical span (horizon at mid-height), so horizontalFovDeg is exact for
// each file: horizontalFovDeg = 62 × width / height.
//
// Each forward ring sits at the yaw of the counter's green football-pitch
// panel; arriveYaw is that panel's yaw in the next photo, so the view stays on
// the counter through the whole walk. walkZoom: start from the panel's angular
// width (20.4° → 32.7° → 43.2°, i.e. 1.63 and 1.35 on screen), then checked
// in the browser by comparing the last zoomed frame with the arrival frame:
// step1 → step2 overshot by ~7 % (parallax), so 1.5; step2 → step3 matched.
export const TOUR_NODES: TourNode[] = [
  {
    id: "step1",
    name_ka: "შესასვლელი",
    panoramaUrl: "/tour/step1.jpg",
    horizontalFovDeg: 263.16,
    // panel x 1200–1400 of 2576; floor in front of it from −22° down
    links: [{ nodeId: "step2", yaw: 1.2, pitch: -25.5, arriveYaw: 7.2, walkZoom: 1.5 }],
  },
  {
    id: "step2",
    name_ka: "დარბაზი",
    panoramaUrl: "/tour/step2.jpg",
    horizontalFovDeg: 291.72,
    // panel x 1207–1496; it reaches the bottom of the photo (no floor visible
    // in front of it), so the ring sits on the lower panel
    links: [{ nodeId: "step3", yaw: 7.2, pitch: -25, arriveYaw: -3, walkZoom: 1.35 }],
  },
  {
    id: "step3",
    name_ka: "დახლი",
    panoramaUrl: "/tour/step3.jpg",
    horizontalFovDeg: 296.6,
    // panel x 1075–1450, centred at −3°
    links: [],
  },
];

export const TOUR_START_NODE_ID = "step1";
