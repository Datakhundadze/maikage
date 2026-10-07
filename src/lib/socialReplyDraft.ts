import { supabase } from "@/integrations/supabase/client";
import type { SocialChannel } from "@/lib/socialInbox";

// Client helper for the admin social inbox "პასუხის პროექტი" button. Calls the
// admin-only gemini-proxy "social-reply-draft" action and maps its typed error
// codes to short Georgian messages, so the inbox can render one inline error
// line without try/catch. Modelled on src/lib/faqChat.ts.
//
// The server reads the thread itself (with the admin's own session), so only
// the conversation's identity and an optional operator hint are sent. The
// draft is returned for copying only — nothing is sent to Meta and nothing is
// written to social_messages.

export type SocialReplyDraftResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

export const HINT_MAX_CHARS = 300;

const ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: "სესია ამოიწურა — შედით თავიდან.",
  ADMIN_REQUIRED: "ეს ფუნქცია მხოლოდ ადმინისტრატორისთვისაა.",
  BAD_REQUEST: "არასწორი მოთხოვნა.",
  EMPTY_THREAD: "საუბარში შეტყობინებები არ არის.",
  SERVICE_UNAVAILABLE: "AI სერვისი დროებით მიუწვდომელია — სცადეთ ცოტა ხანში.",
  RATE_LIMITED: "ძალიან ბევრი მოთხოვნა — სცადეთ ცოტა ხანში.",
};
const GENERIC_ERROR = "პროექტის შექმნა ვერ მოხერხდა — სცადეთ თავიდან.";

const messageFor = (code: unknown): string =>
  (typeof code === "string" && ERROR_MESSAGES[code]) || GENERIC_ERROR;

export async function socialReplyDraft(
  channel: SocialChannel,
  customerId: string,
  hint?: string,
): Promise<SocialReplyDraftResult> {
  const cleanHint = (hint ?? "").trim().slice(0, HINT_MAX_CHARS);

  const { data, error } = await supabase.functions.invoke("gemini-proxy", {
    body: {
      action: "social-reply-draft",
      params: { channel, customer_id: customerId, ...(cleanHint ? { hint: cleanHint } : {}) },
    },
  });

  // Non-2xx → FunctionsHttpError; the JSON body (with `code`) is in error.context.
  if (error) {
    let code: unknown;
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        code = body?.code;
        // A gateway 429 may arrive without a code.
        if (!code && error.context.status === 429) code = "RATE_LIMITED";
      }
    } catch {
      /* ignore parse errors — fall through to generic */
    }
    return { ok: false, message: messageFor(code) };
  }

  // Some setups surface the code on the 2xx body instead of throwing.
  if (typeof data?.code === "string") return { ok: false, message: messageFor(data.code) };

  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) return { ok: false, message: GENERIC_ERROR };
  return { ok: true, text };
}
