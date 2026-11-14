// Showroom design → the constructor's layer coordinates (2026-11-14).
//
// The showroom draws a print on the site's product photo hung in a rack photo
// (garmentPhoto.drawGarment): positions are fractions of a print AREA, in the
// pixels of that picture. The constructor stores a layer as fractions of the
// product photo's own placement ZONE (SimplePage drawPhotoOntoCanvas:
// centre = zone + zoneSize·coords.xy, width = zoneW·scale). Both sit on the
// same product photo, so the bridge is that photo: showroom pixel → fraction of
// the photo (through `box`, the rectangle the photo was drawn into) → fraction
// of the zone.
//
// David: "the screenshot must reach us exactly as it has to be printed."
// Pure — no canvas, no React; text width is measured by the caller.
import type { PlacementCoords } from "@/lib/catalog";
import { textSize, type GarmentDesign, type Rect } from "./garmentPhoto";

/** The catalog zone on the product photo: centre and size as fractions of the photo. */
export interface Zone {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
}

/** renderTextRasterCanvas: pad = 0.18 × font size on each side of the word. */
export const RASTER_PAD = 0.18;

const r4 = (n: number) => Math.round(n * 10000) / 10000 + 0; // + 0: never -0

/** A rectangle in showroom pixels (centre, size) as constructor layer coords. */
export function toLayerCoords(cx: number, cy: number, w: number, h: number, box: Rect, zone: Zone): PlacementCoords {
  const zw = zone.scale;
  const zh = zone.scaleY ?? zone.scale;
  const u = (cx - box.x) / box.w;
  const v = (cy - box.y) / box.h;
  return {
    x: r4((u - (zone.x - zw / 2)) / zw),
    y: r4((v - (zone.y - zh / 2)) / zh),
    scale: r4(w / box.w / zw),
    scaleY: r4(h / box.h / zh),
  };
}

/** The photo of a design, exactly where drawGarment draws it. */
export function photoLayerCoords(d: GarmentDesign, aspect: number, A: Rect, box: Rect, zone: Zone): PlacementCoords {
  const w = A.w * d.scale;
  return toLayerCoords(A.x + d.x * A.w, A.y + d.y * A.h, w, w / aspect, box, zone);
}

/**
 * The lettering of a design, where drawGarment draws it. `measured` is the
 * text's natural width at textSize(d, A) px in its font; drawGarment squeezes
 * it into a max width, so the same limit applies here. Only x, y and the width
 * matter to the constructor (it derives the height from the rendered word).
 */
export function textLayerCoords(d: GarmentDesign, photoAspect: number | null, measured: number, A: Rect, box: Rect, zone: Zone): PlacementCoords {
  const size = textSize(d, A);
  const own = d.tx !== undefined && d.ty !== undefined;
  // The constructor fits the WORD'S RASTER to the box width, and that raster is
  // the word plus a pad of RASTER_PAD × font size on each side (SimplePage
  // renderTextRasterCanvas) — so the box is that much wider than the word.
  const w = Math.min(measured, A.w * (own ? 1.4 : 1.05)) * (measured > 0 ? 1 + (2 * RASTER_PAD * size) / measured : 1);
  let cx: number;
  let cy: number;
  if (own) {
    cx = A.x + (d.tx as number) * A.w;
    cy = A.y + (d.ty as number) * A.h;
  } else {
    cx = A.x + d.x * A.w;
    const ih = photoAspect ? (A.w * d.scale) / photoAspect : 0;
    cy = A.y + d.y * A.h + (photoAspect ? ih / 2 + size * 0.9 : 0);
  }
  return toLayerCoords(cx, cy, w, size, box, zone);
}
