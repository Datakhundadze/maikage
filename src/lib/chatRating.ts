// 1–5 star rating of the site AI chat (ChatWidget and /chat).
//
// WHEN THE CARD APPEARS. Once per conversation, inline at the end of the
// transcript, when:
//   - the bot has given at least MIN_REPLIES real answers (local greetings,
//     nudges and error bubbles do not count — they never reach chat_logs, and
//     the server refuses a rating for a session with fewer than two logged
//     assistant replies), and
//   - the conversation has been quiet for IDLE_MS (no reply in flight).
// It never blocks closing the chat and never pops up over anything. Rated or
// dismissed is remembered per session id for the life of the tab.
//
// WHERE IT GOES. public.submit_chat_rating (SECURITY DEFINER RPC, migration
// 20261019120000_chat_ratings.sql). chat_ratings itself is deny-all; the RPC is
// the only write path. It is schema-ahead-of-types → (supabase as any).
import { supabase } from "@/integrations/supabase/client";

export const MIN_REPLIES = 2;
export const IDLE_MS = 30_000;
export const MAX_RATING_COMMENT = 500;
/** Ratings at or below this ask "what was missing?". */
export const COMMENT_BELOW_OR_AT = 3;

const STORAGE_PREFIX = "maika_chat_rating:";

export type RatingState = "rated" | "dismissed";

interface CountableMsg {
  role: "user" | "assistant";
  local?: boolean;
}

/** Real (server-logged) assistant replies in a transcript. */
export function realReplyCount(messages: CountableMsg[]): number {
  let n = 0;
  for (const m of messages) if (m.role === "assistant" && !m.local) n += 1;
  return n;
}

/** Enough of a conversation to be worth rating. Idle timing is the caller's. */
export function isRatingEligible(messages: CountableMsg[], loading: boolean): boolean {
  if (loading) return false;
  if (messages.length === 0) return false;
  // The last word must be the bot's: a customer who just typed is mid-question.
  if (messages[messages.length - 1].role !== "assistant") return false;
  return realReplyCount(messages) >= MIN_REPLIES;
}

export function readRatingState(sessionId: string): RatingState | null {
  try {
    const v = sessionStorage.getItem(STORAGE_PREFIX + sessionId);
    return v === "rated" || v === "dismissed" ? v : null;
  } catch {
    return null;
  }
}

export function writeRatingState(sessionId: string, state: RatingState): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + sessionId, state);
  } catch {
    /* private mode / blocked storage: the card may simply be offered again */
  }
}

export type SubmitRatingResult = "ok" | "duplicate" | "no_session" | "invalid" | "error";

export async function submitChatRating(input: {
  sessionId: string;
  rating: number;
  comment?: string | null;
  lang: string;
}): Promise<SubmitRatingResult> {
  const rating = Math.round(input.rating);
  if (!input.sessionId || rating < 1 || rating > 5) return "invalid";
  const comment = (input.comment ?? "").trim().slice(0, MAX_RATING_COMMENT) || null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc("submit_chat_rating", {
      p_session_id: input.sessionId,
      p_rating: rating,
      p_comment: comment,
      p_lang: input.lang,
    });
    if (error) return "error";
    return data === "ok" || data === "duplicate" || data === "no_session" || data === "invalid" ? data : "error";
  } catch {
    return "error";
  }
}

/** Average to one decimal, or null when there is nothing to average. */
export function averageRating(ratings: number[]): number | null {
  if (ratings.length === 0) return null;
  const sum = ratings.reduce((a, b) => a + b, 0);
  return Math.round((sum / ratings.length) * 10) / 10;
}
