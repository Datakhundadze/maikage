// Auto-applying a sketch, for the one case where it costs the customer nothing.
//
// A maika-mockup reply used to render „ესკიზის ნახვა" and wait. When the block
// can be applied for free to a constructor the customer is ALREADY looking at,
// that click is pure friction: they asked to see the design and got a button.
//
// This module is the single place that decides. Both chats — the floating
// ChatWidget and the /chat page — call tryAutoOpenSketch and nothing else, so
// the two surfaces cannot drift apart the way a copied button would.
//
// ── WHY ONLY THE LIVE PATH ────────────────────────────────────────────────
// openMockupInConstructor ends in window.open, which browsers permit only
// inside a trusted user-activation window. Fired without a click it returns
// null, the caller falls through to navigate(), and the chat tab the customer
// is reading is torn down under them. applyMockupToLiveConstructor is the other
// half — a synchronous, cancelable CustomEvent claimed by a mounted SimplePage
// — and it needs no gesture at all. That is the only half fired here.
//
// ── WHY editPrompt AND removeBackground ARE EXCLUDED ──────────────────────
// Both spend a generation from the customer's allowance (guests get 2 per 24h).
// Spending someone's quota without a click is wrong even when it is exactly
// what they asked for, so those blocks keep the button and the customer keeps
// the decision. The test is on the BLOCK's fields, not on whether a photo
// happens to be attached: the conservative reading, deliberately.
import type { ChatSuggestion } from "@/lib/generateSuggestion";
import { applyMockupToLiveConstructor } from "@/lib/mockupSuggestion";

/**
 * Is this suggestion the free, automatic kind?
 *
 * maika-generate and maika-order-status are never eligible and are not even
 * considered here — a generation always spends the allowance, and an order
 * lookup is a query the customer should choose to run.
 */
export function isAutoSketchEligible(suggestion: ChatSuggestion | null | undefined): boolean {
  if (!suggestion || suggestion.kind !== "mockup") return false;
  const { editPrompt, removeBackground } = suggestion.mockup;
  return !editPrompt && !removeBackground;
}

// FIRE-ONCE, keyed on the suggestion OBJECT rather than on any index or id.
//
// writeConstructorSeed is not involved on this path, but the receiver still
// applies whatever it is handed, so a second fire would add the design twice.
// The parsed mockup object is created once per reply and then lives in the
// message list, so its identity is exactly "this suggestion" — stable across
// every re-render, and across the widget's minimise/expand, which UNMOUNTS the
// message list entirely and would defeat a component-level ref. A WeakSet also
// lets the entry go when the transcript is trimmed.
//
// Restored-from-storage messages are deliberately NOT covered by this: they are
// fresh objects after a reload. They never reach here, because firing happens
// in the reply handler at the moment a reply is parsed, not from a render
// effect — a restored transcript replays no sketches.
const fired = new WeakSet<object>();

/**
 * Apply the sketch automatically if — and only if — all three hold:
 *
 *   a) a SimplePage is mounted in this tab and CLAIMS the payload;
 *   b) the block carries no editPrompt and no removeBackground;
 *   c) this suggestion has not been fired before.
 *
 * `attachment` must be the photo THIS turn was sent with, passed in explicitly.
 * It is not read from a closure here on purpose: the caller's handoff callback
 * closes over its own `attachment`, and a customer who attaches a new photo
 * while the reply is in flight would otherwise hand off the wrong picture.
 *
 * @returns true when a live constructor took it and the caller should suppress
 *   its button. false in EVERY other case — nothing mounted, receiver declined,
 *   ineligible block, already fired, anything thrown — and the caller then
 *   renders the button exactly as before. This never navigates and never opens
 *   a tab; a failed auto-apply falls back to the button, never to a route
 *   change.
 */
export function tryAutoOpenSketch(
  suggestion: ChatSuggestion | null | undefined,
  attachment: string | null,
): boolean {
  if (!isAutoSketchEligible(suggestion) || suggestion?.kind !== "mockup") return false;
  const { mockup } = suggestion;
  // Marked BEFORE the attempt, so neither a throw nor a decline can leave a
  // path open to firing the same suggestion twice. A decline costs nothing:
  // the button appears and the ordinary click path runs unchanged.
  if (fired.has(mockup)) return false;
  fired.add(mockup);
  try {
    return applyMockupToLiveConstructor(mockup, attachment);
  } catch {
    return false;
  }
}
