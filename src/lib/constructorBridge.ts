// In-place handoff to a constructor that is ALREADY on screen.
//
// THE PROBLEM. The floating widget is mounted on every route except /chat, and
// the constructor is one of those routes. So a customer can be standing in the
// constructor, open the widget, ask for a design, and be sent to a SECOND TAB
// containing the constructor they were already looking at. The seed contract is
// right; the new tab is absurd.
//
// HOW WE KNOW A CONSTRUCTOR IS LIVE. We don't detect it — we ASK, and the
// answer is authoritative rather than inferred:
//
//   - The sender dispatches a CANCELABLE CustomEvent on window.
//   - A mounted SimplePage listens, and claims the payload by calling
//     preventDefault().
//   - dispatchEvent is SYNCHRONOUS — every listener has run by the time it
//     returns — and it returns false exactly when preventDefault() was called.
//     So the sender knows, on the next line, whether anyone took it.
//
// Every alternative is a guess. Reconstructing App.tsx's routing
// (`mode === "simple" && pathname === "/"`) duplicates logic that lives
// elsewhere and rots when it changes — and it is already wrong today, because
// SimplePage is ALSO the "/" <Route> for every mode that isn't in that list.
// Probing the DOM for a marker element asks about markup rather than about the
// component. A module-level "is it mounted" counter is closer, but still
// answers "is one mounted?" when the question is "did one take this?" — a
// SimplePage that is mounted but busy must be able to decline, and with the
// handshake, declining costs nothing: the sender simply falls back to the tab.
//
// If nobody claims it, the caller writes the seed and opens a tab exactly as
// before. Nothing about the existing path changes.
import { normalizeConstructorSeed, type ConstructorSeed } from "@/lib/constructorSeed";

export const CONSTRUCTOR_APPLY_EVENT = "maika:constructor-apply";

/** The event's payload is exactly a seed — same shape, same validation. */
export type ConstructorApplyEvent = CustomEvent<ConstructorSeed>;

/**
 * Offer a seed to a live constructor in THIS tab.
 *
 * The payload is timestamped on the way out so the receiver can run it through
 * normalizeConstructorSeed unchanged — an in-place seed is validated by exactly
 * the same code, and subject to exactly the same TTL, as one that travelled
 * through localStorage.
 *
 * @returns true when a live constructor claimed it and the caller is done;
 *   false when nothing took it and the caller should fall back to the seed +
 *   new-tab path.
 */
export function offerToLiveConstructor(seed: ConstructorSeed): boolean {
  if (typeof window === "undefined") return false;
  // Reject a payload the receiver would reject anyway, so "claimed" can never
  // mean "claimed and silently dropped".
  const stamped = { ...seed, ts: Date.now() };
  if (!normalizeConstructorSeed(stamped)) return false;
  try {
    const ev = new CustomEvent<ConstructorSeed>(CONSTRUCTOR_APPLY_EVENT, {
      detail: stamped,
      cancelable: true,
    });
    // false ⇔ a listener called preventDefault() ⇔ somebody took it.
    return window.dispatchEvent(ev) === false;
  } catch {
    return false;
  }
}
