// Customer feedback submission, shared by the footer modal and the
// post-order form on the confirmation page.
//
// ONE INSERT SHAPE, ONE PLACE. Both surfaces write the same row to the same
// table under the same "Anyone can submit feedback" policy; the only thing
// that differs is which fields they collect. Keeping the insert here means a
// column added on one surface cannot quietly diverge from the other, and the
// length bound below cannot drift from the policy that enforces it.
import { supabase } from "@/integrations/supabase/client";

/**
 * Message length ceiling, and NOT an arbitrary one: the INSERT policy on
 * public.feedback carries `WITH CHECK (char_length(message) BETWEEN 1 AND
 * 2000)`, so a longer message is rejected by the database rather than by the
 * UI. Both surfaces import this rather than redeclaring it, so the two can
 * never drift apart from each other or from the policy.
 */
export const MAX_FEEDBACK_MESSAGE = 2000;

export interface FeedbackSubmission {
  /** The customer's words. Trimmed and bounded by the caller of record below. */
  message: string;
  /** Optional reply address. The post-order form omits it — we have the order. */
  email?: string | null;
  /** Which surface it came from; today `location.pathname`. */
  page?: string | null;
  /** Null for guests, which is the common case on both surfaces. */
  userId?: string | null;
  /**
   * The order this feedback is about, when it was left from the confirmation
   * page. Null everywhere else.
   *
   * ⚠️ CUSTOMER-SUPPLIED, NOT AUTHORITATIVE. The INSERT policy validates only
   * the message length, so an anonymous caller can post any uuid here. Treat
   * it as a hint for the admin reading it, never as proof the feedback belongs
   * to that order.
   */
  orderId?: string | null;
}

/**
 * Insert one feedback row.
 *
 * Returns an Error rather than throwing, so a caller can decide how loudly to
 * report it. Neither surface may let a failed insert affect anything else on
 * its page — on the confirmation page in particular, the payment state must be
 * completely untouched by this.
 */
export async function submitFeedback(input: FeedbackSubmission): Promise<{ error: Error | null }> {
  const message = input.message.trim().slice(0, MAX_FEEDBACK_MESSAGE);
  if (!message) return { error: new Error("empty") };
  try {
    const { error } = await supabase.from("feedback").insert({
      message,
      email: input.email?.trim() || null,
      page: input.page ?? null,
      user_id: input.userId ?? null,
      order_id: input.orderId ?? null,
    });
    if (error) throw error;
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err : new Error(String(err)) };
  }
}
