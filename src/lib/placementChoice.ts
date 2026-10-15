// "ამ მხარეს უკვე არის დიზაინი" — replace or add.
//
// A design handed over from the FLOATING chat (the constructor seed, or a
// generation the floating chat asked for) used to be appended unconditionally.
// On a side that already carried a photo the new one landed on top of it,
// half-size and offset, and the old one had to be deleted by hand. SimplePage
// now asks first; these are the pure rules it applies, so they are tested
// without mounting the page.
//
// Scope, deliberately narrow:
// - PHOTO layers only. Lettering is never removed by a replace.
// - Only designs that arrive from the floating chat. The in-panel "Transfer"
//   and manual uploads keep appending, exactly as before.

export type PlacementDecision = "replace" | "add";

/** Shown only for a side that already has a photo, and not for the chat's own reuse case. */
export function needsPlacementChoice(existingPhotoCount: number, sameChatAttachment: boolean): boolean {
  return existingPhotoCount > 0 && !sameChatAttachment;
}

/**
 * Replace is offered only while no AI action is running on the page: an
 * in-flight edit or background removal writes back to a layer by id, and that
 * layer must not disappear under it. Add is always offered.
 */
export function canReplace(aiBusy: boolean): boolean {
  return !aiBusy;
}

interface WithPhotos<P> {
  photos: P[];
}

/**
 * One side with its photo layers removed and its lettering untouched, plus the
 * removed layers — kept, unmodified, for undo.
 */
export function removeSidePhotos<P, S extends WithPhotos<P>>(side: S): { next: S; removed: P[] } {
  return { next: { ...side, photos: [] }, removed: side.photos };
}

/**
 * Undo a replace: drop the layers the replace placed and put the removed ones
 * back exactly as they were — same objects, so the same ids, positions and
 * crops — in their original stacking order, beneath anything else added since.
 * Ids already present are not duplicated.
 */
export function restoreSidePhotos<P extends { id: string }, S extends WithPhotos<P>>(
  side: S,
  removed: P[],
  placedIds: string[],
): S {
  const placed = new Set(placedIds);
  const kept = side.photos.filter((p) => !placed.has(p.id));
  const keptIds = new Set(kept.map((p) => p.id));
  return { ...side, photos: [...removed.filter((p) => !keptIds.has(p.id)), ...kept] };
}

/** How long the "დიზაინი შეიცვალა · დაბრუნება" undo stays available. */
export const PLACEMENT_UNDO_MS = 8000;
