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
  /** id of the node this arrow leads to */
  nodeId: string;
  /** where the arrow sits in THIS panorama, degrees */
  yaw: number;
  pitch: number;
}

export interface TourNode {
  id: string;
  /** Georgian label: navbar caption and arrow tooltip */
  name_ka: string;
  panoramaUrl: string;
  links: TourLink[];
  /**
   * Omit for a full 2:1 equirectangular sphere. For a partial / cylindrical
   * shot (iPhone Pano) pass partialPanoData(), or a fixed PanoData when the
   * crop is known.
   */
  panoData?: PanoData | PanoDataProvider;
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

// Temporary placeholders (public/tour/). Node 1 is a full sphere; node 2 is a
// 360° × 60° strip, so both panorama shapes are exercised before real shots
// arrive.
export const TOUR_NODES: TourNode[] = [
  {
    id: "entrance",
    name_ka: "შესასვლელი",
    panoramaUrl: "/tour/placeholder-entrance.jpg",
    links: [{ nodeId: "hall", yaw: 0, pitch: -10 }],
  },
  {
    id: "hall",
    name_ka: "დარბაზი",
    panoramaUrl: "/tour/placeholder-hall.jpg",
    panoData: partialPanoData(360),
    links: [{ nodeId: "entrance", yaw: 180, pitch: -10 }],
  },
];

export const TOUR_START_NODE_ID = "entrance";
