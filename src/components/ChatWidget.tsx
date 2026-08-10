import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageCircle, X, Send, ImagePlus } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { faqChat, type FaqMessage } from "@/lib/faqChat";
import { downscaleDataUrl } from "@/lib/imageDownscale";
import {
  type MockupSuggestion,
  openMockupInConstructor,
  CONSTRUCTOR_URL,
} from "@/lib/mockupSuggestion";
// Shared with /chat — same parse, same precedence, same button.
import {
  type ChatSuggestion,
  type GenerateSuggestion,
  parseChatSuggestion,
  openGenerateInConstructor,
} from "@/lib/generateSuggestion";
import ChatSuggestionActions from "@/components/ChatSuggestionActions";
import ChatMarkdown from "@/components/ChatMarkdown";

const ACCENT = "#26BB89";

// Photo attachment bounds — identical to ChatPage. The file is gated BEFORE it
// is read, then downscaled; the image is passed to the model as a base64 data
// URL on that one request and is NEVER uploaded to storage.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ATTACH_MAX_EDGE = 1024;
const ATTACH_QUALITY = 0.8;

// A chat message in the widget. `local` marks UI-only bubbles (the seed
// greeting + error notices) so they are NOT replayed as conversation history
// to the model — only real user questions and real bot answers are.
interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  local?: boolean;
  /** The one validated suggestion parsed off this turn, if any. */
  suggestion?: ChatSuggestion;
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
  const { lang, setMode } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Downscaled data URL of the attached photo. Retained after sending so the
  // "ესკიზის ნახვა" handoff can still use it; only the preview is hidden.
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachmentSent, setAttachmentSent] = useState(false);
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
    // Hide the thumbnail; `attachment` itself is retained for the handoff.
    setAttachmentSent(true);
    setLoading(true);

    // Only real (non-local) turns become conversation history for the model.
    const history: FaqMessage[] = next
      .filter((m) => !m.local)
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await faqChat(history, lang, sessionIdRef.current, attachment ?? undefined);
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
    // Strip the fence on ANY match FIRST so raw JSON never reaches the bubble,
    // then parse + validate separately. Same pipeline the /chat page uses.
    let suggestion: ChatSuggestion | undefined;
    if (!local) {
      const parsed = parseChatSuggestion(reply, !!attachment);
      reply = parsed.text;
      suggestion = parsed.suggestion ?? undefined;
    }
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local, suggestion }]);
  }, [input, loading, messages, lang, attachment]);

  // Same handoff as /chat: new tab on success, this tab only if popup-blocked.
  const openInConstructor = useCallback((m: MockupSuggestion) => {
    if (!openMockupInConstructor(m, attachment)) {
      setMode("simple");
      navigate(CONSTRUCTOR_URL);
    }
  }, [attachment, setMode, navigate]);

  // Same handoff for a generation request. No attachment — a generation starts
  // from words, not from the customer's photo.
  const openGenerate = useCallback((g: GenerateSuggestion) => {
    if (!openGenerateInConstructor(g)) {
      setMode("simple");
      navigate(CONSTRUCTOR_URL);
    }
  }, [setMode, navigate]);

  // Gate the pick BEFORE reading it: non-images and files over 10MB are
  // rejected so an oversized payload is never built. Bilingual message.
  const handleFilePick = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setAttachError(null);
    if (!file.type.startsWith("image/")) {
      setAttachError(lang === "en" ? "Please choose an image file." : "აირჩიეთ სურათი.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setAttachError(
        lang === "en"
          ? "That image is too large (max 10MB)."
          : "სურათი ძალიან დიდია (მაქს. 10MB).",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      setAttachment(await downscaleDataUrl(reader.result as string, ATTACH_MAX_EDGE, ATTACH_QUALITY));
      setAttachmentSent(false);
    };
    reader.onerror = () => {
      setAttachError(lang === "en" ? "Could not read that file." : "ფაილის წაკითხვა ვერ მოხერხდა.");
    };
    reader.readAsDataURL(file);
  }, [lang]);

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
        // Theme-aware fill: the old hardcoded #26BB89 equals the light
        // ("green") theme's own page background, so the launcher vanished there.
        // bg-primary contrasts against the page in both themes (banana on black
        // in dark, white on green in light) and primary-foreground keeps the
        // icon legible on the fill.
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
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
              {/* Assistant output is markdown (whitespace-pre-wrap above keeps
                  single newlines). User text stays plain — React escapes it. */}
              {m.role === "assistant" ? <ChatMarkdown text={m.content} /> : m.content}
              {/* Only for a fully-validated suggestion; a failed parse leaves
                  it undefined and the prose stands alone. */}
              <ChatSuggestionActions
                suggestion={m.suggestion}
                lang={lang}
                compact
                onMockup={openInConstructor}
                onGenerate={openGenerate}
              />
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

      {/* Composer */}
      <div className="border-t border-border bg-card p-2 shrink-0">
        {attachError && <p className="px-1 pb-1.5 text-xs text-destructive">{attachError}</p>}
        {attachment && !attachmentSent && (
          <div className="flex items-center gap-2 px-1 pb-2">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border">
              <img src={attachment} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setAttachment(null)}
                aria-label={lang === "en" ? "Remove image" : "სურათის მოშორება"}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 hover:bg-black/80 transition-colors"
              >
                <X className="h-3 w-3 text-white" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground truncate">
              {lang === "en" ? "Photo attached" : "სურათი მიმაგრებულია"}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFilePick} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={lang === "en" ? "Attach a photo" : "სურათის მიმაგრება"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
        >
          <ImagePlus className="h-4 w-4" />
        </button>
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
          className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-[#26BB89]/40"
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
    </div>
  );
}
