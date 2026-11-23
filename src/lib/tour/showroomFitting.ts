// The showroom's fitting room (David 2026-11-23: "when I press the virtual
// fitting room, can it go to the real one — where the red curtain is?").
//
// "გასახდელი" in the rack designer no longer opens the constructor in a new
// tab: the walk goes to the shop's real fitting room (the red curtain, seen
// from the NIKE end of the walk) and the site's own fitting-room dialog
// (TryOnModal, unchanged) opens there with the printed garment.
//
// The designer is unmounted by the walk, so:
//   · what the fitting room needs travels in the request (the print, the
//     printed garment, and the order seed for the dialog's "order" button);
//   · the designer's state is kept per brand and taken back when the visitor
//     returns to the rack — the design is not lost by trying it on.
import type { ConstructorSeed } from "@/lib/constructorSeed";

export interface ShowroomFitting {
  /** The rack to go back to (rack id) and its brand. */
  rackId: string;
  brand: string;
  /** The print alone, and the garment with it (garmentFilm). */
  designImage: string;
  garmentImage: string;
  /** The order this design makes (order: true, the size if one was picked); null if it could not be built. */
  orderSeed: ConstructorSeed | null;
}

export const SHOWROOM_FITTING_EVENT = "maika:showroom-fitting";

let pending: ShowroomFitting | null = null;

export function askShowroomFitting(f: ShowroomFitting): void {
  pending = f;
  window.dispatchEvent(new Event(SHOWROOM_FITTING_EVENT));
}
export function takeShowroomFitting(): ShowroomFitting | null {
  const f = pending;
  pending = null;
  return f;
}

// The designer's own state, kept while the visitor is at the curtain.
const kept = new Map<string, unknown>();
export function keepRackDesign(brand: string, state: unknown): void {
  kept.set(brand, state);
}
export function hasRackDesign(brand: string): boolean {
  return kept.has(brand);
}
export function takeRackDesign<T>(brand: string): T | null {
  const s = (kept.get(brand) as T | undefined) ?? null;
  kept.delete(brand);
  return s;
}

/** Where the walk stands to face the curtain (read off stills/1188.webp). */
export const FITTING_STOP = { t: 118.8, yawDeg: -110, pitchDeg: -6 } as const;
