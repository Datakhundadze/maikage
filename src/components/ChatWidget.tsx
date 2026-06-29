import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle, X, Send } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { faqChat, type FaqMessage } from "@/lib/faqChat";

const ACCENT = "#26BB89";

// A chat message in the widget. `local` marks UI-only bubbles (the seed
// greeting + error notices) so they are NOT replayed as conversation history
// to the model — only real user questions and real bot answers are.
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  local?: boolean;
}

// Animated "typing…" dots shown while a reply is in flight.
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

export default function ChatWidget() {
  const { lang } = useAppState();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // One stable id per widget mount so the server can group this conversation
  // in the admin chat-history log. Resets on reload (a new visit = new session).
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  // Keep the list pinned to the newest message / typing indicator.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  const openPanel = useCallback(() => {
    setOpen(true);
    // Seed a local bilingual greeting on first open (no API call).
    setMessages((prev) => (prev.length === 0 ? [{ role: "assistant", content: t(lang, "chat.greeting"), local: true }] : prev));
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [lang]);

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
      reply = res.kind === "rate_limited"
        ? t(lang, "chat.errorRate")
        : res.kind === "blocked"
          ? t(lang, "chat.errorBlocked")
          : t(lang, "chat.errorGeneric");
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local }]);
  }, [input, loading, messages, lang]);

  // Hide entirely on admin — checked AFTER hooks so hook order stays stable.
  if (location.pathname.startsWith("/admin")) return null;

  // ── Closed: round launcher ──
  if (!open) {
    return (
      <button
        type="button"
        onClick={openPanel}
        aria-label={t(lang, "chat.launcher")}
        title={t(lang, "chat.launcher")}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        style={{ backgroundColor: ACCENT }}
      >
        <MessageCircle className="h-6 w-6" />
      </button>
    );
  }

  // ── Open: panel (desktop card bottom-right; mobile full-width bottom sheet) ──
  return (
    <div
      className="fixed z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-6 sm:right-6 flex flex-col w-full sm:w-[360px] h-[80vh] sm:h-auto sm:max-h-[70vh] rounded-t-2xl sm:rounded-2xl border border-border bg-card text-card-foreground shadow-2xl overflow-hidden"
      role="dialog"
      aria-label={t(lang, "chat.title")}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-white shrink-0" style={{ backgroundColor: ACCENT }}>
        <div className="flex items-center gap-2 min-w-0">
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold truncate">{t(lang, "chat.title")}</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t(lang, "chat.close")}
          className="rounded-md p-1 hover:bg-white/20 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Message list */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-background">
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

      {/* Input row */}
      <div className="flex items-center gap-2 border-t border-border bg-card p-2 shrink-0">
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
          className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#26BB89]/40"
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim()}
          aria-label={t(lang, "chat.send")}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-40"
          style={{ backgroundColor: ACCENT }}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
