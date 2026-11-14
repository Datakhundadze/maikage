// The chat's sketch, inside the showroom (2026-11-14).
//
// Everywhere else the site chat hands a sketch to the constructor. From the
// showroom that would end the visit, so here the design goes onto the garment
// the visitor has open — the rack photo designer — exactly as if they had put
// the photo and the lettering there by hand; "ბეჭდვა" and "შეკვეთა" then work
// as always. If that product's rack is not open, the walk goes to it first.
//
// One pending design, module-level: the chat offers it, the walk routes it,
// the rack sheet opens its designer for it, the designer takes it. The event
// only says "there is one"; whoever can route it claims it with
// preventDefault(), and an unclaimed offer is dropped so the chat keeps its
// button (no showroom on screen, a product the showroom has no rack for).
export interface ShowroomChatDesign {
  /** Catalog brand of the product the bot named ("GILDAN", "GILDAN Hoodie"…), if any. */
  brand?: string;
  product?: string;
  color?: string;
  side?: "front" | "back";
  text?: string;
  /** A name from the constructor's text palette. */
  textColor?: string;
  /** The customer's photo (data URL). */
  image?: string;
  /** The photo shows a ready garment: its print alone (extract-print-web). */
  extract?: boolean;
}

export const SHOWROOM_DESIGN_EVENT = "maika:showroom-design";

let pending: ShowroomChatDesign | null = null;

/** Offer a design to the showroom. true = somebody is routing it. */
export function offerShowroomDesign(d: ShowroomChatDesign): boolean {
  if (typeof window === "undefined") return false;
  if (!d.text?.trim() && !d.image) return false;
  pending = d;
  let claimed = false;
  try {
    claimed = window.dispatchEvent(new CustomEvent(SHOWROOM_DESIGN_EVENT, { cancelable: true })) === false;
  } catch {
    claimed = false;
  }
  if (!claimed) pending = null;
  return claimed;
}

/** The pending design, left in place. */
export function peekShowroomDesign(): ShowroomChatDesign | null {
  return pending;
}

/** Is the pending design meant for this brand (or for whatever is open)? */
export function showroomDesignFits(brand: string): boolean {
  return !!pending && (!pending.brand || pending.brand === brand);
}

/** Take the pending design if it is for this brand; it is then gone. */
export function takeShowroomDesign(brand: string): ShowroomChatDesign | null {
  if (!showroomDesignFits(brand)) return null;
  const d = pending;
  pending = null;
  return d;
}

/** Drop it (routing failed after the claim). */
export function dropShowroomDesign(): void {
  pending = null;
}
