import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Send } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { faqChat, type FaqMessage } from "@/lib/faqChat";
import SeoHead from "@/components/SeoHead";

// Standalone full-page FAQ chat, linked from the social-media auto-responders
// outside business hours. The floating ChatWidget is left exactly as it is —
// the message-state and UI below are a deliberate duplicate of it, NOT a shared
// extraction, so the working widget never has to be refactored.
//
// Almost every visitor arrives on a phone from the Facebook / Instagram in-app
// browser, so the layout is viewport-height with a scrolling list and the input
// pinned to the bottom.

// A chat message. `local` marks UI-only bubbles (the seed greeting + error
// notices) so they are NOT replayed as conversation history to the model —
// only real user questions and real bot answers are. Mirrors ChatWidget.
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  local?: boolean;
}

// Animated "typing…" dots shown while a reply is in flight (mirrors ChatWidget).
function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-hidden="true">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-current opacity-60 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export default function ChatPage() {
  const { lang } = useAppState();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // One stable id per page mount. The "chatpage-" prefix makes these
  // conversations recognizable against widget ones in the admin chat history
  // (chat_logs has no source/channel column, and this needs no schema change).
  // In-memory only — resets on reload, same as the widget.
  const sessionIdRef = useRef<string>(`chatpage-${crypto.randomUUID()}`);

  // Keep the list pinned to the newest message / typing indicator.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);

  // Seed the same local bilingual greeting the widget shows on first open
  // (no API call). The page has no open/closed state, so it seeds on mount.
  useEffect(() => {
    setMessages((prev) => (prev.length === 0 ? [{ role: "assistant", content: t(lang, "chat.greeting"), local: true }] : prev));
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);

    // Only real (non-local) turns become conversation history for the model.
    const history: FaqMessage[] = next
      .filter((m) => !m.local)
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await faqChat(history, lang, sessionIdRef.current);
    setLoading(false);

    let reply: string;
    let local = false;
    if (res.ok) {
      reply = res.text;
    } else {
      local = true;
      const kind = (res as { ok: false; kind: "rate_limited" | "blocked" | "error" }).kind;
      reply = kind === "rate_limited"
        ? t(lang, "chat.errorRate")
        : kind === "blocked"
          ? t(lang, "chat.errorBlocked")
          : t(lang, "chat.errorGeneric");
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local }]);
  }, [input, loading, messages, lang]);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <SeoHead title={`${t(lang, "chat.title")} | Maika.ge`} noindex />

      {/* Minimal chrome: brand mark doubles as the way back to the site. No
          nav — someone arriving from an auto-responder wants the chat. */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-4 py-3 shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          aria-label="maika.ge"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-base font-black">
            M
          </span>
          <span className="text-sm font-bold tracking-tight truncate">maika.ge</span>
        </Link>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{t(lang, "chat.title")}</span>
        </span>
      </header>

      {/* Message list */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.role === "user"
                  ? "bg-foreground text-background rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              }`}
            >
              {/* Plain text only — React escapes by default (no dangerouslySetInnerHTML). */}
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-foreground">
              <TypingDots />
              <span className="sr-only">{t(lang, "chat.typing")}</span>
            </div>
          </div>
        )}
      </div>

      {/* Input row — pinned to the bottom; pb honours the phone's home indicator. */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t(lang, "chat.placeholder")}
          maxLength={1000}
          className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label={t(lang, "chat.send")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
