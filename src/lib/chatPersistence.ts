// Survive a reload for the FAQ chat transcript.
//
// THE PROBLEM. Both chats held their transcript in useState and nothing else,
// so the conversation died on: a page reload, the OAuth login redirect
// (LoginModal's Google/Apple paths navigate the document away), moving between
// the widget and /chat, and Back from checkout. The last of those is the
// expensive one — a customer who had described a design, agreed a price and
// reached payment came back to an empty box.
//
// STORAGE. sessionStorage, not localStorage: the transcript should outlive a
// navigation, not a visit. It is per-tab, which is also right — two tabs are
// two conversations, and that is already true of the session id.
//
// ⚠️ THE IMAGE IS NEVER PERSISTED. sessionStorage is ~5MB per origin and a
// single 1024px JPEG data URL is 200–350KB; a handful would exhaust it and
// take the transcript down with them. The bubble records only that a photo was
// there (`hadImage`), and the restored bubble shows a placeholder. This also
// keeps the existing promise intact: the customer's photo is request-scoped
// and never lands at rest on their device.
//
// ⚠️ EVERY CALL IS GUARDED. These run inside the Facebook and Instagram in-app
// browsers, where storage can be absent, restricted, or throw on write. Every
// path degrades to today's behaviour — an empty transcript — and never throws.

/** One persisted turn. Deliberately NOT the full ChatMsg: no image data URL. */
export interface PersistedChatMsg {
  role: "user" | "assistant";
  content: string;
  local?: boolean;
  /** True when this turn carried a photo whose bytes were not kept. */
  hadImage?: boolean;
  /** The parsed suggestion, if any — small JSON, and it keeps the button alive. */
  suggestion?: unknown;
  /**
   * This turn's sketch was applied automatically to a live constructor, so the
   * button was suppressed. Persisted so a reload does not resurrect a button
   * that would add the same design a second time.
   */
  autoApplied?: boolean;
  /**
   * This turn's sketch button was PRESSED. Persisted for exactly the reason
   * `suggestion` is: the suggestion keeps the button alive across reloads, so
   * an unpersisted spent-mark would resurrect a LIVE button for a design
   * already on the garment — the very stacking this flag exists to stop.
   */
  applied?: boolean;
}

interface PersistedChat {
  sessionId: string;
  messages: PersistedChatMsg[];
  /**
   * Widget only: was the panel open when this was written?
   *
   * The transcript already survived the OAuth redirect — but the widget's
   * `open` flag was plain useState, so a customer who signed in with
   * Google/Apple came back to a CLOSED bubble. Their conversation was intact
   * one click away, and indistinguishable from lost. Signing in is now a step
   * INSIDE the order-status conversation, so that seam had to go.
   *
   * Undefined for the /chat surface, which is a whole page and has no
   * open/closed state to restore.
   */
  open?: boolean;
}

/**
 * Serialised ceiling before we start dropping the oldest turns.
 *
 * 256KB of UTF-16 is roughly 128k characters — around 400 turns of ordinary
 * Georgian chat, and about 5% of the ~5MB origin budget. Generous for the real
 * case and small enough that this feature can never be the reason another
 * feature's write fails. Without the image data URLs there is nothing here
 * that grows quickly.
 */
const MAX_SERIALISED_CHARS = 256 * 1024;

/** Per-surface key: the widget and /chat are separate conversations. */
export type ChatSurface = "widget" | "page";
const keyFor = (surface: ChatSurface) => `maika-chat-${surface}`;

/**
 * Restore a transcript, or null when there is nothing usable.
 *
 * Validates shape rather than trusting it: sessionStorage is writable by
 * anything on the origin, and a malformed blob must read as "no transcript"
 * rather than crash the chat on mount.
 */
export function loadChat(surface: ChatSurface): PersistedChat | null {
  try {
    const raw = sessionStorage.getItem(keyFor(surface));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedChat>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.sessionId !== "string" || !parsed.sessionId) return null;
    if (!Array.isArray(parsed.messages)) return null;
    const messages = parsed.messages.filter(
      (m): m is PersistedChatMsg =>
        !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    if (messages.length === 0) return null;
    return {
      sessionId: parsed.sessionId,
      messages,
      open: parsed.open === true,
    };
  } catch {
    return null;
  }
}

/**
 * Persist a transcript, dropping the OLDEST turns if it would exceed the cap.
 *
 * Trimming from the front keeps the end of the conversation, which is the part
 * a returning customer needs. A write that still fails — quota, private mode,
 * a locked-down in-app browser — is swallowed: the customer simply gets
 * today's behaviour on their next reload.
 */
export function saveChat(
  surface: ChatSurface,
  sessionId: string,
  messages: PersistedChatMsg[],
  open?: boolean,
): void {
  try {
    let slice = messages;
    let payload = JSON.stringify({ sessionId, messages: slice, open });
    while (payload.length > MAX_SERIALISED_CHARS && slice.length > 1) {
      slice = slice.slice(Math.max(1, Math.ceil(slice.length * 0.25)));
      payload = JSON.stringify({ sessionId, messages: slice, open });
    }
    if (payload.length > MAX_SERIALISED_CHARS) return; // one turn over the cap: keep nothing
    sessionStorage.setItem(keyFor(surface), payload);
  } catch {
    /* quota, private mode, restricted in-app browser — degrade silently */
  }
}

/** Drop a surface's transcript. Safe when there is none. */
export function clearChat(surface: ChatSurface): void {
  try {
    sessionStorage.removeItem(keyFor(surface));
  } catch {
    /* ignore */
  }
}

/** Drop BOTH transcripts — used on sign-out, so the next person sees nothing. */
export function clearAllChats(): void {
  clearChat("widget");
  clearChat("page");
}
