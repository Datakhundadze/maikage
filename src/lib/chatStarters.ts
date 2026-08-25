/**
 * The starter chips shown under the greeting on /chat, before the first turn.
 *
 * EDIT THE WORDING HERE. The order is the render order, and nothing else in the
 * app knows this text — changing a phrase, adding a fifth or dropping one is a
 * change to this list alone.
 *
 * These are ORDINARY CUSTOMER MESSAGES. Tapping a chip calls the same send()
 * the input calls, producing the same history, the same request and the same
 * parsing — there is no chip-specific path. The first one deliberately elicits
 * a maika-generate block; that block costs a generation when ITS OWN button is
 * pressed, and a tap here spends nothing.
 *
 * (This lives beside the page rather than inside it because a component module
 * that also exports a constant trips react-refresh/only-export-components, and
 * because "edit the wording without touching the component" is more literally
 * true from here.)
 */
export const CHAT_STARTERS = [
  "დამიხატე მგელი მთვარეზე",
  "რა ღირს ჰუდი?",
  "სად მდებარეობთ?",
  "სად არის ჩემი შეკვეთა?",
] as const;
