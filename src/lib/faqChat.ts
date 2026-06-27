import { supabase } from "@/integrations/supabase/client";
import type { Lang } from "@/lib/i18n";

// Client helper for the FAQ chatbot. SEPARATE from the image `callGemini`
// (which throws when data.image is missing) — faq-chat returns text, never an
// image. Calls the gemini-proxy "faq-chat" action and maps the proxy's typed
// error codes to a discriminated result so the widget can render friendly,
// bilingual bubbles without try/catch.

export type FaqRole = "user" | "assistant";
export interface FaqMessage {
  role: FaqRole;
  content: string;
}

export type FaqResult =
  | { ok: true; text: string }
  | { ok: false; kind: "rate_limited" | "blocked" | "error" };

export async function faqChat(messages: FaqMessage[], lang: Lang): Promise<FaqResult> {
  // Send only user/assistant turns (the proxy re-sanitizes anyway), last 8,
  // each capped — mirrors the server-side bounds so payloads stay small.
  const clean = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));

  const { data, error } = await supabase.functions.invoke("gemini-proxy", {
    body: { action: "faq-chat", params: { messages: clean, lang } },
  });

  // Non-2xx → FunctionsHttpError; the JSON body (with `code`) is in error.context.
  if (error) {
    let code: string | undefined;
    try {
      if (error.context && typeof error.context.json === "function") {
        const body = await error.context.json();
        code = body?.code;
      }
    } catch {
      /* ignore parse errors — fall through to generic */
    }
    if (code === "RATE_LIMITED") return { ok: false, kind: "rate_limited" };
    if (code === "GENERATION_BLOCKED") return { ok: false, kind: "blocked" };
    return { ok: false, kind: "error" };
  }

  // Some setups surface the code on the 2xx body instead of throwing.
  if (data?.code === "RATE_LIMITED") return { ok: false, kind: "rate_limited" };
  if (data?.code === "GENERATION_BLOCKED") return { ok: false, kind: "blocked" };

  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) return { ok: false, kind: "error" };
  return { ok: true, text };
}
