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
import { loadImg, type GarmentDesign } from "@/lib/tour/garmentPhoto";

export interface ShowroomFitting {
  /** The rack to go back to (rack id) and its brand. */
  rackId: string;
  brand: string;
  /** The print alone, and the garment with it (garmentFilm). */
  designImage: string;
  garmentImage: string;
  /** The order this design makes (order: true, the size if one was picked); null if it could not be built. */
  orderSeed: ConstructorSeed | null;
  /** The designer's state as plain data (pictures as data URLs), for the stash below. */
  keptPlain?: KeptPlain;
}

/** The designer's kept state with its pictures as data URLs — what survives a page load. */
export interface KeptPlain {
  color: string;
  side: "front" | "back";
  size: string;
  designs: Record<"front" | "back", Omit<GarmentDesign, "img"> & { imgSrc: string | null }>;
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
// 2026-11-23, from David's phone recording: at pitch −6 a tall screen showed the
// jerseys on the wall and only the curtain's top edge. Lower (not below ~−20: the
// floor under the camera is a soft patch), so the curtain is in the middle.
export const FITTING_STOP = { t: 118.8, yawDeg: -108, pitchDeg: -16 } as const;


// ── Signing in from the fitting room ────────────────────────────────────────
// A guest who has used up the free generations is asked to sign in inside the
// fitting-room dialog, and Google / Apple sign-in is a FULL page navigation.
// David's recording of 2026-11-23: he came back to the welcome screen with the
// design, the garment and the place all gone. So while the dialog is open the
// request is kept in sessionStorage; a showroom that loads with it present
// goes straight back to the curtain and opens the dialog again, and the rack
// has its design back.
const FITTING_STASH_KEY = "maika.showroom.fitting";
const FITTING_STASH_MAX_AGE_MS = 30 * 60 * 1000;

export function stashFitting(f: ShowroomFitting): void {
  const put = (v: ShowroomFitting) => window.sessionStorage.setItem(FITTING_STASH_KEY, JSON.stringify({ at: Date.now(), f: v }));
  try {
    put(f);
  } catch {
    // too big for the storage: without the designer's copy, then without the order
    try {
      put({ ...f, keptPlain: undefined });
    } catch {
      try {
        put({ ...f, keptPlain: undefined, orderSeed: null });
      } catch {
        /* nothing kept: signing in will start the visit over, as before */
      }
    }
  }
}
export function dropFittingStash(): void {
  try {
    window.sessionStorage.removeItem(FITTING_STASH_KEY);
  } catch {
    /* ignore */
  }
}
export function readFittingStash(): ShowroomFitting | null {
  try {
    const raw = window.sessionStorage.getItem(FITTING_STASH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: unknown; f?: Partial<ShowroomFitting> };
    if (typeof v.at !== "number" || Date.now() - v.at > FITTING_STASH_MAX_AGE_MS) return null;
    const f = v.f;
    if (!f || typeof f.designImage !== "string" || typeof f.garmentImage !== "string" || typeof f.brand !== "string") return null;
    return { rackId: typeof f.rackId === "string" ? f.rackId : "", brand: f.brand, designImage: f.designImage, garmentImage: f.garmentImage, orderSeed: f.orderSeed ?? null, keptPlain: f.keptPlain };
  } catch {
    return null;
  }
}
/** Give the rack its design back from a stashed request (pictures are loaded first). */
export async function restoreKeptDesign(f: ShowroomFitting): Promise<void> {
  const k = f.keptPlain;
  if (!k) return;
  const side = async (d: KeptPlain["designs"]["front"]): Promise<GarmentDesign> => {
    const { imgSrc, ...rest } = d;
    let img: HTMLImageElement | null = null;
    if (imgSrc) {
      try {
        img = await loadImg(imgSrc);
      } catch {
        img = null;
      }
    }
    return { ...rest, img };
  };
  keepRackDesign(f.brand, { designs: { front: await side(k.designs.front), back: await side(k.designs.back) }, color: k.color, side: k.side, size: k.size });
}
