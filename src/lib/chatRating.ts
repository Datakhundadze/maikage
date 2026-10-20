// End-of-conversation rating for the site assistant (ChatWidget + /chat).
//
// ONE PLACE for: when the row may show, the once-per-session memory, the insert
// and the admin summary maths — so the two chat surfaces cannot drift apart,
// and the comment bound cannot drift from the CHECK in
// supabase/migrations/20261020141000_chat_ratings.sql.
import { supabase } from "@/integrations/supabase/client";

/** Real (non-local) assistant replies needed before the row is offered. */
export const CHAT_RATING_MIN_REPLIES = 2;

/** Mirrors `CHECK (char_length(comment) <= 300)` on public.chat_ratings. */
export const MAX_RATING_COMMENT = 300;

/**
 * Real assistant replies in a transcript. Local bubbles — the seeded greeting,
 * error notices, the photo nudge — are not answers and do not count.
 */
export function countAssistantReplies(messages: ReadonlyArray<{ role: string; local?: boolean }>): number {
  let n = 0;
  for (const m of messages) if (m.role === "assistant" && !m.local) n++;
  return n;
}

/** Pure gate: offer the row after ≥2 real replies, never once rated/dismissed. */
export function shouldShowRating(assistantReplies: number, done: boolean): boolean {
  return !done && assistantReplies >= CHAT_RATING_MIN_REPLIES;
}

// ── Once per session_id (localStorage, every access guarded) ───────────────
// localStorage rather than sessionStorage: a rated conversation restored in a
// later tab must not ask again. Unavailable storage (in-app browsers, private
// mode) degrades to "not done" — the server's unique(session_id) still keeps
// it to one row.
const doneKey = (sessionId: string) => `maika-chat-rating:${sessionId}`;

export type RatingDoneKind = "rated" | "dismissed";

export function isRatingDone(sessionId: string): boolean {
  try {
    return !!localStorage.getItem(doneKey(sessionId));
  } catch {
    return false;
  }
}

export function markRatingDone(sessionId: string, kind: RatingDoneKind): void {
  try {
    localStorage.setItem(doneKey(sessionId), kind);
  } catch {
    /* storage unavailable — degrade silently */
  }
}

// ── Insert ─────────────────────────────────────────────────────────────────
export interface ChatRatingSubmission {
  sessionId: string;
  rating: number;
  comment?: string | null;
  lang?: string | null;
  page?: string | null;
}

/**
 * Insert one rating. A second rating for the same session is silently ignored
 * (ON CONFLICT DO NOTHING; 23505 is treated the same as a fallback). Never
 * throws — a failed rating must never affect the chat.
 */
export async function submitChatRating(input: ChatRatingSubmission): Promise<{ error: Error | null }> {
  const rating = Math.round(input.rating);
  if (!input.sessionId || !(rating >= 1 && rating <= 5)) return { error: new Error("invalid") };
  const comment = (input.comment ?? "").trim().slice(0, MAX_RATING_COMMENT) || null;
  try {
    let userId: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      userId = data?.session?.user?.id ?? null;
    } catch {
      userId = null;
    }
    // chat_ratings is schema-ahead-of-types → (supabase as any), as elsewhere.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("chat_ratings")
      .upsert(
        {
          session_id: input.sessionId,
          rating,
          comment,
          lang: input.lang ?? null,
          page: (input.page ?? null)?.slice(0, 300) ?? null,
          user_id: userId,
        },
        { onConflict: "session_id", ignoreDuplicates: true },
      );
    if (error && (error as { code?: string }).code !== "23505") throw error;
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String((err as { message?: string })?.message ?? err)) };
  }
}

// ── Admin summary ──────────────────────────────────────────────────────────
export interface RatingRow {
  rating: number;
  created_at: string;
}

export interface RatingSummary {
  count: number;
  /** null when there are no ratings in the window. */
  average: number | null;
  /** index 0 → 1 star … index 4 → 5 stars. */
  distribution: [number, number, number, number, number];
}

/** Ratings within the last `days` days of `now`. */
export function summarizeRatings(rows: ReadonlyArray<RatingRow>, days: number, now: Date = new Date()): RatingSummary {
  const since = now.getTime() - days * 24 * 60 * 60 * 1000;
  const distribution: RatingSummary["distribution"] = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    const v = Number(r.rating);
    if (!(t >= since) || !(v >= 1 && v <= 5)) continue;
    distribution[Math.round(v) - 1]++;
    count++;
    sum += Math.round(v);
  }
  return { count, average: count ? sum / count : null, distribution };
}
