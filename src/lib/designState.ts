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
  text: DesignStateText | null;
  zone: DesignStateZone;
}

export interface DesignState {
  version: 1;
  front: DesignStateSide | null;
  back: DesignStateSide | null;
}

export function isDesignState(value: unknown): value is DesignState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && ("front" in v || "back" in v);
}
