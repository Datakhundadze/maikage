// Structured editor state persisted on orders.design_state so the admin
// panel can reproduce a customer's design layout (and the print shop can
// re-render a print file) without depending on the customer's browser to
// successfully upload a rendered PNG at checkout.

export interface DesignStatePhoto {
  /** Public URL of the uploaded original (full-resolution). Null if the
   *  upload failed at checkout time — coords are still preserved so admin
   *  can request a re-upload from the customer. */
  url: string | null;
  x: number;
  y: number;
  scale: number;
  scaleY: number;
  rotation: number;
  /** Render order, low to high (matches upload order). */
  z_order: number;
  /** Source image's natural width / height. Stored so the admin
   *  compositor can derive source height without re-loading the image.
   *  Optional — older orders predate the crop UX. */
  natural_aspect?: number;
  /** Source crop / pan state. All in zone fractions (same units as
   *  `scale`). `source_scale` is the source width; `source_offset_x/y`
   *  is the source center offset from the window center. Optional —
   *  when missing the compositor renders cover-fit-centered, matching
   *  the visual behaviour of orders placed before the crop UX shipped. */
  source_scale?: number;
  source_offset_x?: number;
  source_offset_y?: number;
}

export interface DesignStateText {
  content: string;
  /** CSS font-family value, e.g. `'Oswald', sans-serif`. */
  font: string;
  /** Display name for admin UI, e.g. `Oswald`. */
  fontName: string;
  color: string;
  x: number;
  y: number;
  scale: number;
  scaleY: number;
  rotation: number;
}

/** Placement zone snapshot in canvas-fraction coordinates. */
export interface DesignStateZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignStateSide {
  side: "front" | "back";
  photos: DesignStatePhoto[];
  /** All text elements on this side (multi-text). Written by current code. */
  texts?: DesignStateText[];
  /** @deprecated Legacy single text. Orders placed before multi-text store
   *  one text object here; current code never writes it. Read via
   *  getDesignStateTexts(), which falls back to [text] when `texts` is absent. */
  text?: DesignStateText | null;
  zone: DesignStateZone;
}

export interface DesignState {
  version: 1;
  front: DesignStateSide | null;
  back: DesignStateSide | null;
}

/** Backward-compatible read of a side's text elements. New orders store
 *  `texts`; older orders store a single `text`. Returns [] when neither is
 *  present, so callers can always iterate. */
export function getDesignStateTexts(side: DesignStateSide): DesignStateText[] {
  if (side.texts && side.texts.length) return side.texts;
  if (side.text && side.text.content) return [side.text];
  return [];
}

export function isDesignState(value: unknown): value is DesignState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && ("front" in v || "back" in v);
}
