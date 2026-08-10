import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Send, ImagePlus, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { faqChat, type FaqMessage } from "@/lib/faqChat";
import { downscaleDataUrl } from "@/lib/imageDownscale";
import SeoHead from "@/components/SeoHead";

// Photo attachment bounds. The file is gated BEFORE it is read, so an
// oversized pick never becomes a payload; it is then downscaled to 1024px /
// JPEG q0.8 (~150-250KB) before it is sent. The image is passed to the model
// as a base64 data URL on that one request — it is NEVER uploaded to storage
// and never written to any bucket or table.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ATTACH_MAX_EDGE = 1024;
const ATTACH_QUALITY = 0.8;

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

// Markdown renderer for ASSISTANT output only. The model writes markdown
// (**bold**, "- " bullets), which used to print with literal asterisks.
//
// ⚠️ Deliberately NOT MarkdownView: that renderer is safe (no rehype-raw, no
// dangerouslySetInnerHTML) but carries blog behaviour that is wrong for model
// output — a bare YouTube URL becomes a third-party <iframe>, and `img` loads
// arbitrary remote images. Model text must never be able to embed either.
//
// ⚠️ XSS: react-markdown renders NO raw HTML without rehype-raw (not a
// dependency here), so model output can only produce the whitelisted elements
// below. Never add rehype-raw or dangerouslySetInnerHTML to this component.
// Media is dropped outright; links are forced to open safely.
function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Chat-scale blocks: tight margins, no article-sized headings.
        p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-background/40 px-1 py-0.5 text-[13px] font-mono">{children}</code>
        ),
        // Headings collapse to emphasised text — a chat bubble is not an article.
        h1: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        h2: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        h3: ({ children }) => <p className="font-semibold my-1.5 first:mt-0">{children}</p>,
        // Media is NOT rendered from model output.
        img: () => null,
      }}
    >
      {text}
    </ReactMarkdown>
  );
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
  const fileRef = useRef<HTMLInputElement>(null);
  // Downscaled data URL of the photo the customer attached. Held in component
  // state and deliberately RETAINED after sending — a later task hands it to
  // the constructor. Never uploaded anywhere.
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
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

  // Gate the pick BEFORE reading it: reject non-images and anything over 10MB
  // so an oversized payload is never built, let alone sent. Bilingual message.
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
          ? "That image is too large (max 10MB). Please pick a smaller one."
          : "სურათი ძალიან დიდია (მაქს. 10MB). აირჩიეთ პატარა.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const raw = reader.result as string;
      // Downscale before it ever leaves the device.
      setAttachment(await downscaleDataUrl(raw, ATTACH_MAX_EDGE, ATTACH_QUALITY));
    };
    reader.onerror = () => {
      setAttachError(lang === "en" ? "Could not read that file." : "ფაილის წაკითხვა ვერ მოხერხდა.");
    };
    reader.readAsDataURL(file);
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

    // The attachment rides on THIS request only — it is never pushed into
    // `messages`, so it cannot enter history or be resent on a later turn.
    // Kept in state afterwards for the follow-up constructor task.
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
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local }]);
  }, [input, loading, messages, lang, attachment]);

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
              {/* Assistant output is markdown (whitespace-pre-wrap above keeps
                  single newlines inside a paragraph). User text stays plain —
                  React escapes it, and it is never parsed as markup. */}
              {m.role === "assistant" ? <ChatMarkdown text={m.content} /> : m.content}
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

      {/* Composer — pinned to the bottom; pb honours the phone's home indicator. */}
      <div className="border-t border-border bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
        {/* Attachment preview / rejection notice, above the input row. */}
        {attachError && (
          <p className="px-1 pb-1.5 text-xs text-destructive">{attachError}</p>
        )}
        {attachment && (
          <div className="flex items-center gap-2 px-1 pb-2">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border">
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
            <span className="text-xs text-muted-foreground">
              {lang === "en" ? "Photo attached" : "სურათი მიმაგრებულია"}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFilePick}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={lang === "en" ? "Attach a photo" : "სურათის მიმაგრება"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground transition-colors"
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
    </div>
  );
}
