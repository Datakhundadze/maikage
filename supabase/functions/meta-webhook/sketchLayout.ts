// DM sketch — where things go (pure maths, no I/O).
//
// The geometry is the website's, copied from the places that own it:
//
//   findProductImage   ← catalog.findImageForColor (exact → White base to tint →
//                        any colour), PNG instead of the browser's .webp swap
//   placementBox       ← generation.compositeMockup: coords are ZONE-relative
//   design coords      ← SimplePage.seededGenerationCoords (chest / small) and
//                        DEFAULT_PHOTO_COORDS (zone fill, the default)
//   text coords        ← SimplePage.seededTextCoordsFor / staggeredTextCoords(0)
//                        / chestTextCoords / JERSEY_*_COORDS
//
// One deliberate difference: compositeMockup cover-crops the design to the
// box; the sketch CONTAIN-fits it (aspect kept, centred), so nothing the
// customer asked for is cut off.

import { COLORS, ENTRIES, FRONT_ONLY_PRODUCTS, type SnapshotEntry, type SnapshotZone } from "./catalogSnapshot.ts";
import { availableColors, type Placement, type ProductChoice } from "./sketchParse.ts";

export interface Coords { x: number; y: number; scale: number; scaleY?: number }
export interface Box { x: number; y: number; w: number; h: number }

// ── product photo ──────────────────────────────────────────────────────────

export interface ProductImage {
  url: string;
  zone: SnapshotZone;
  /** null = the photo already is this colour; otherwise tint the white base to this hex. */
  tintHex: string | null;
  /** The garment's own colour hex (for the default text colour). */
  garmentHex: string | null;
  view: "front" | "back";
}

function entry(type: string, sub: string, color: string, view: string): SnapshotEntry | undefined {
  return ENTRIES.find((e) => e.type === type && e.sub === sub && e.color === color && e.view === view);
}

/** The colour tint ProductPreview applies: pure black softened to #1a1a1a. */
export function tintHexFor(color: string): string {
  if (color === "Black") return "#1a1a1a";
  return COLORS.find((c) => c.name === color)?.hex ?? "#FFFFFF";
}

export function findProductImage(t: ProductChoice): ProductImage | null {
  // Front-only products never show a back (the site's toggle is not rendered).
  const view = FRONT_ONLY_PRODUCTS.includes(t.product) ? "front" : t.side;
  const garmentHex = COLORS.find((c) => c.name === t.color)?.hex ?? null;
  const exact = entry(t.product, t.subProduct, t.color, view);
  if (exact?.url) return { url: exact.url, zone: exact.zone, tintHex: null, garmentHex, view };
  const white = entry(t.product, t.subProduct, "White", view);
  if (white?.url) return { url: white.url, zone: white.zone, tintHex: tintHexFor(t.color), garmentHex, view };
  for (const c of availableColors(t.product, t.subProduct)) {
    const e = entry(t.product, t.subProduct, c, view);
    if (e?.url) return { url: e.url, zone: e.zone, tintHex: tintHexFor(t.color), garmentHex, view };
  }
  return null;
}

// ── coordinates ────────────────────────────────────────────────────────────

const CHEST_SCALE_FACTOR = 0.85;
const CHEST_Y = 0.3;
const CHEST_X_OFFSET = 0.22;
const DEFAULT_PHOTO_COORDS: Coords = { x: 0.5, y: 0.5, scale: 1, scaleY: 1 };
const DEFAULT_TEXT_COORDS: Coords = { x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 };
const SEED_TEXT_SCALE_FACTOR = 2;
const SPORT_SEED_TEXT_Y = 0.38;
export const JERSEY_NAME_COORDS: Coords = { x: 0.5, y: 0.13, scale: 0.60, scaleY: 0.10 };
export const JERSEY_NUMBER_COORDS: Coords = { x: 0.5, y: 0.50, scale: 0.30, scaleY: 0.34 };

/** Wearer's left chest = viewer's right = larger x (front photos face the viewer). */
const chestX = (p: "left-chest" | "right-chest") => (p === "left-chest" ? 0.5 + CHEST_X_OFFSET : 0.5 - CHEST_X_OFFSET);

/** Where a generated design goes inside the zone. */
export function designCoords(placement: Placement | undefined): Coords {
  const chestBox = CHEST_SCALE_FACTOR * 0.5;
  if (placement === "left-chest" || placement === "right-chest") {
    return { x: chestX(placement), y: CHEST_Y, scale: chestBox, scaleY: chestBox };
  }
  if (placement === "small") return { ...DEFAULT_PHOTO_COORDS, scale: chestBox, scaleY: chestBox };
  return { ...DEFAULT_PHOTO_COORDS };
}

/** Where a seeded text layer goes inside the zone. */
export function textCoords(placement: Placement | undefined, product: string): Coords {
  if (placement === "left-chest" || placement === "right-chest") {
    return {
      x: chestX(placement),
      y: CHEST_Y,
      scale: DEFAULT_TEXT_COORDS.scale * CHEST_SCALE_FACTOR,
      scaleY: (DEFAULT_TEXT_COORDS.scaleY ?? DEFAULT_TEXT_COORDS.scale) * CHEST_SCALE_FACTOR,
    };
  }
  if (placement === "small") return { ...DEFAULT_TEXT_COORDS };
  const seeded: Coords = {
    ...DEFAULT_TEXT_COORDS,
    scale: DEFAULT_TEXT_COORDS.scale * SEED_TEXT_SCALE_FACTOR,
    scaleY: (DEFAULT_TEXT_COORDS.scaleY ?? DEFAULT_TEXT_COORDS.scale) * SEED_TEXT_SCALE_FACTOR,
  };
  return product === "Sport" ? { ...seeded, y: SPORT_SEED_TEXT_Y } : seeded;
}

// ── boxes ──────────────────────────────────────────────────────────────────

/** compositeMockup's maths: the coords' box, in pixels of a w×h product image. */
export function placementBox(zone: SnapshotZone, coords: Coords, w: number, h: number): Box {
  const zoneW = w * zone.scale;
  const zoneH = h * (zone.scaleY ?? zone.scale);
  const zoneLeft = w * zone.x - zoneW / 2;
  const zoneTop = h * zone.y - zoneH / 2;
  const boxW = zoneW * coords.scale;
  const boxH = zoneH * (coords.scaleY ?? coords.scale);
  return {
    x: zoneLeft + zoneW * coords.x - boxW / 2,
    y: zoneTop + zoneH * coords.y - boxH / 2,
    w: boxW,
    h: boxH,
  };
}

/** Largest srcW×srcH rectangle that fits in `box` with the same aspect, centred. */
export function containFit(box: Box, srcW: number, srcH: number): Box {
  if (!(srcW > 0) || !(srcH > 0) || !(box.w > 0) || !(box.h > 0)) return { x: box.x, y: box.y, w: 0, h: 0 };
  const s = Math.min(box.w / srcW, box.h / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/** Output size: `targetW` wide (about 1024), height by the photo's aspect. */
export function outputSize(srcW: number, srcH: number, targetW = 1024): { w: number; h: number } {
  const w = Math.max(1, Math.round(targetW));
  return { w, h: Math.max(1, Math.round((srcH / srcW) * w)) };
}

/** Scale a box from one image size to another. */
export function scaleBox(b: Box, sx: number, sy: number): Box {
  return { x: b.x * sx, y: b.y * sy, w: b.w * sx, h: b.h * sy };
}

// ── text colour ────────────────────────────────────────────────────────────

/** textColors.relativeLuminance (WCAG 2.1). */
export function relativeLuminance(hex: string | null | undefined): number | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const ch = (byte: number) => {
    const s = byte / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(parseInt(h.slice(0, 2), 16)) + 0.7152 * ch(parseInt(h.slice(2, 4), 16)) + 0.0722 * ch(parseInt(h.slice(4, 6), 16));
}

/** textColors.contrastingTextColorHex: black on light garments, white on dark. */
export function contrastingTextColorHex(garmentHex: string | null | undefined): string {
  const l = relativeLuminance(garmentHex);
  if (l === null) return "#000000";
  return l > 0.1791 ? "#000000" : "#FFFFFF";
}
