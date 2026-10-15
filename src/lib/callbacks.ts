// Shared helpers for the admin "დარეკვის მოთხოვნები" tab (AdminCallbacks) and
// its link into "ჩატის ისტორია" (AdminChatHistory). Kept out of the component
// files so they stay component-only modules.

export type CallbackStatus = "new" | "called" | "no_answer" | "done";

export const CALLBACK_STATUS_ORDER: CallbackStatus[] = ["new", "called", "no_answer", "done"];

export const CALLBACK_STATUS_LABELS: Record<CallbackStatus, string> = {
  new: "ახალი",
  called: "დავურეკეთ",
  no_answer: "არ უპასუხა",
  done: "დასრულებული",
};

/** "+995577123456" → "+995 577 12 34 56"; anything else unchanged. */
export function displayPhone(phone: string): string {
  const m = /^\+995(\d{3})(\d{2})(\d{2})(\d{2})$/.exec(phone);
  return m ? `+995 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : phone;
}

/** Query param AdminChatHistory reads to open one conversation. */
export const CHAT_SESSION_PARAM = "session";

/** Opens the conversation in the ჩატის ისტორია tab. */
export function chatSessionHref(sessionId: string): string {
  return `/admin?tab=chat-history&${CHAT_SESSION_PARAM}=${encodeURIComponent(sessionId)}`;
}
