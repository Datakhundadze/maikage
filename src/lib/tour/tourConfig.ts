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

// Real shop photos, both PARTIAL iPhone Pano shots (temporary copies in
// public/tour/; final files will come from Supabase storage).
//
// TUNING: horizontalFovDeg is how wide the photo is treated as being (the
// angle the shot actually swept gives the most natural perspective); the
// vertical span scales with it. Link yaw/pitch place the floor ring: yaw must
// stay within ±horizontalFovDeg/2 and pitch within the photo's vertical span
// (unit-tested against the actual image files). arriveYaw is where the next
// photo opens.
export const TOUR_NODES: TourNode[] = [
  {
    id: "center",
    name_ka: "ცენტრი",
    panoramaUrl: "/tour/center.jpg",
    horizontalFovDeg: 170,
    // toward the counter and the blue chair, right side of the photo
    links: [{ nodeId: "counter", yaw: 70, pitch: -22, arriveYaw: -20 }],
  },
  {
    id: "counter",
    name_ka: "დახლი",
    panoramaUrl: "/tour/counter.jpg",
    horizontalFovDeg: 150,
    // toward the t-shirt racks, left side of the photo
    links: [{ nodeId: "center", yaw: -60, pitch: -20, arriveYaw: 0 }],
  },
];

export const TOUR_START_NODE_ID = "center";
