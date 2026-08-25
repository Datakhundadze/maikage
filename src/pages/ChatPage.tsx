import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Send, ImagePlus, X } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { faqChat, type FaqMessage } from "@/lib/faqChat";
import { downscaleDataUrl } from "@/lib/imageDownscale";
import { loadChat, saveChat, type PersistedChatMsg } from "@/lib/chatPersistence";
import {
  type MockupSuggestion,
  openMockupInConstructor,
  CONSTRUCTOR_URL,
} from "@/lib/mockupSuggestion";
// The one place that decides whether a sketch may skip its button — shared by
// this chat and the other so the two can never diverge.
import { tryAutoOpenSketch } from "@/lib/autoSketch";
// Both chats parse and render through the shared module, so the fence
// precedence, the validation and the button can never drift between them.
import {
  type ChatSuggestion,
  type GenerateSuggestion,
  parseChatSuggestion,
  openGenerateInConstructor,
} from "@/lib/generateSuggestion";
import ChatSuggestionActions from "@/components/ChatSuggestionActions";
import ChatMarkdown from "@/components/ChatMarkdown";
import SeoHead from "@/components/SeoHead";
// The site's own header, reused verbatim — /chat had only a logo, so a
// first-time visitor had no way back in. See the render for why it replaces
// the local bar rather than sitting beside it.
import AppHeader from "@/components/AppHeader";
// The chip wording, kept out of this file so editing it is not a component
// change — and so this module keeps exporting only its component.
import { CHAT_STARTERS } from "@/lib/chatStarters";
// Only mounted once the order-status card's sign-in button is pressed, so
// /chat does not ship the auth UI to every visitor. Same lazy treatment
// AppHeader gives it.
const LoginModal = lazy(() => import("@/components/LoginModal"));

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
  /** The one validated suggestion parsed off this turn, if any. */
  suggestion?: ChatSuggestion;
  /**
   * The sketch was applied automatically to a constructor already mounted in
   * this tab, so no button is rendered — see tryAutoOpenSketch. Absent for
   * every other turn, including one whose auto-apply was declined.
   */
  autoApplied?: boolean;
  /**
   * The photo the customer attached to THIS turn, as the same downscaled data
   * URL that was sent. Display only — it is not resent as history, and it is
   * deliberately never persisted (see the sessionStorage restore).
   */
  image?: string;
  /**
   * This turn carried a photo whose bytes were NOT kept across the reload.
   * Set only on restore; a live bubble uses `image` instead.
   */
  hadImage?: boolean;
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
  const { lang, setMode } = useAppState();
  const navigate = useNavigate();
  // Restored transcript, read ONCE at mount. A photo's bytes are never
  // persisted, so a turn that carried one comes back as `hadImage` and renders
  // a placeholder instead of the picture.
  const restored = useMemo(() => loadChat("page"), []);
  const [messages, setMessages] = useState<ChatMsg[]>(
    () => (restored?.messages ?? []).map((m) => ({
      role: m.role,
      content: m.content,
      local: m.local,
      hadImage: m.hadImage,
      suggestion: m.suggestion as ChatMsg["suggestion"],
      autoApplied: m.autoApplied,
    })),
  );
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
  // The thumbnail is hidden once the message is sent so the customer never
  // thinks a second photo is riding on their next question — but `attachment`
  // itself is deliberately kept, because the "ესკიზის ნახვა" handoff still
  // needs that data URL. Picking a new photo shows the preview again.
  const [attachmentSent, setAttachmentSent] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  // One stable id per page mount. The "chatpage-" prefix makes these
  // conversations recognizable against widget ones in the admin chat history
  // (chat_logs has no source/channel column, and this needs no schema change).
  // In-memory only — resets on reload, same as the widget.
  // Reuse the RESTORED session id so a reloaded conversation keeps grouping
  // under one id in the admin chat log instead of splitting in two.
  const sessionIdRef = useRef<string>(restored?.sessionId ?? `chatpage-${crypto.randomUUID()}`);

  // Keep the list pinned to the newest message / typing indicator.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading]);
  // Persist on every change. Deliberately mirrors state rather than hooking
  // each mutation site, so no future path can forget to save. The image data
  // URL is dropped here — see chatPersistence for why.
  useEffect(() => {
    if (messages.length === 0) return;
    const slim: PersistedChatMsg[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      local: m.local,
      hadImage: !!m.image || m.hadImage,
      suggestion: m.suggestion,
      autoApplied: m.autoApplied,
    }));
    saveChat("page", sessionIdRef.current, slim);
  }, [messages]);


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
      setAttachmentSent(false);
    };
    reader.onerror = () => {
      setAttachError(lang === "en" ? "Could not read that file." : "ფაილის წაკითხვა ვერ მოხერხდა.");
    };
    reader.readAsDataURL(file);
  }, [lang]);

  // `textOverride` is how a starter chip sends: everything below is the
  // identical path, and only the source of the words differs. Setting the input
  // and calling send() instead would read a stale value from this closure.
  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || loading) return;
    // The photo THIS turn is sent with, pinned before the await below. The
    // handoff must carry the picture the model actually saw: a customer who
    // attaches a different photo while the reply is in flight would otherwise
    // have that newer one applied to a sketch it was never part of.
    const sentAttachment = attachment;
    // The attachment rides on the bubble purely so the customer can SEE what
    // they sent; what goes to the model is unchanged (faqChat still receives
    // `attachment` separately, below).
    const next: ChatMsg[] = [...messages, { role: "user", content: text, image: attachment ?? undefined }];
    setMessages(next);
    setInput("");
    // Hide the thumbnail; `attachment` itself is retained for the handoff.
    setAttachmentSent(true);
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
    // Strip the fence on ANY match FIRST, so raw JSON never reaches the bubble
    // even if the parse below fails. Parse + validate separately; a suggestion
    // is only kept when it is actionable (usable text, or a photo to pair with).
    let suggestion: ChatSuggestion | undefined;
    if (!local) {
      const parsed = parseChatSuggestion(reply, !!attachment);
      reply = parsed.text;
      suggestion = parsed.suggestion ?? undefined;
    }
    // FREE SKETCH → SHOW IT, don't ask for a click. Returns true only when a
    // constructor is mounted in THIS tab AND the block spends no generation;
    // every other case is false and the button below renders as it always has.
    const autoApplied = tryAutoOpenSketch(suggestion, sentAttachment) || undefined;
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local, suggestion, autoApplied }]);
  }, [input, loading, messages, lang, attachment]);

  // Hand the design to the constructor: merge ONLY the fields the model
  // actually specified over the stored product config (never overwrite what it
  // didn't mention), stash the design layers, then switch to Simple mode.
  // If the seed write fails (quota / locked-down webview) we still navigate —
  // an empty constructor beats a button that does nothing.
  // Hand off via the shared pipeline. On success the new tab has it and this
  // tab is left completely alone; only a blocked popup falls back to navigating
  // here, so the button is never a no-op.
  const openInConstructor = useCallback((m: MockupSuggestion) => {
    if (!openMockupInConstructor(m, attachment)) {
      setMode("simple");
      navigate(CONSTRUCTOR_URL);
    }
  }, [attachment, setMode, navigate]);

  // Same contract for the generation handoff: the new tab gets it and this tab
  // is left alone; only a blocked popup falls back to navigating here, so the
  // button is never a no-op. No attachment — a generation starts from words.
  const openGenerate = useCallback((g: GenerateSuggestion) => {
    if (!openGenerateInConstructor(g)) {
      setMode("simple");
      navigate(CONSTRUCTOR_URL);
    }
  }, [setMode, navigate]);

  // Anything that is not a UI-only bubble means the conversation is under way.
  // The seed greeting and the local error bubbles carry `local`, so they do not
  // count — which is what keeps the chips visible on a fresh page and retires
  // them permanently after the first real exchange.
  const conversationStarted = messages.some((m) => !m.local);

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <SeoHead title={`${t(lang, "chat.title")} | Maika.ge`} noindex />

      {/* THE SITE'S OWN HEADER, not a second navigation. The page used to carry
          a logo and a "chat" label and nothing else, which left a first-time
          visitor with no way back in. AppHeader already is the primary nav
          everywhere else, and it drops in cleanly here: it is a self-contained
          `h-14 shrink-0` bar, so the composer still pins to the bottom of the
          flex column, and it handles narrow widths itself — the nav strip
          scrolls horizontally and the labels collapse to icons below `sm`.
          It REPLACES the local bar rather than sitting above it; two stacked
          bars would spend 100px of a phone screen on chrome. The page name
          lives in SeoHead above, where it was already. */}
      <AppHeader />

      {/* Message list.
          THE COLUMN IS CAPPED AT 44rem (~700px) AND CENTRED. Bubbles ran to the
          viewport edge, so on a desktop a one-line answer stretched across the
          whole screen. The cap is on an inner wrapper, not on this scroller, so
          the scrollbar stays at the window edge where it belongs.

          THE EMPTY STATE IS VERTICALLY CENTRED — `justify-center` until the
          first real turn, `justify-start` after. The page opened as one bubble
          pinned to the top-left of a tall black field, and the chips would have
          added a second island in the same emptiness. Centring composes the
          greeting and the chips into one block that reads as the page's
          content, rather than as the top of a conversation that has not
          happened. It settles to top-anchored the moment the customer sends
          something, which is the one moment a layout shift is unremarkable —
          they are watching their own message appear, and from then on the
          transcript grows downward as a transcript should. */}
      <div
        ref={listRef}
        className={`flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col ${
          conversationStarted ? "justify-start" : "justify-center"
        }`}
      >
        <div className="mx-auto w-full max-w-[44rem] space-y-2">
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
              {/* The customer's own photo, confirming it was received. Sizing
                  matches SimpleAiChatPanel's result bubbles (max-h, w-auto,
                  object-contain, rounded-lg). A restored-from-storage bubble
                  has no data URL and falls to the placeholder below. */}
              {m.role === "user" && m.image && (
                <img
                  src={m.image}
                  alt={lang === "en" ? "Attached photo" : "მიმაგრებული ფოტო"}
                  className="mt-1.5 max-h-52 w-auto rounded-lg object-contain"
                  draggable={false}
                />
              )}
              {/* Restored from sessionStorage: the turn had a photo but the
                  bytes were deliberately not kept, so say so rather than
                  showing a broken image or silently dropping the fact. */}
              {m.role === "user" && !m.image && m.hadImage && (
                <span className="mt-1.5 flex items-center gap-1 text-[11px] opacity-70">
                  <ImagePlus className="h-3 w-3" />
                  {lang === "en" ? "photo" : "ფოტო"}
                </span>
              )}
              {/* Renders only for a fully-validated suggestion — a failed parse
                  leaves it undefined and the prose stands alone. */}
              <ChatSuggestionActions
                suggestion={m.suggestion}
                autoApplied={m.autoApplied}
                lang={lang}
                onSignIn={() => setShowLogin(true)}
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

        {/* STARTER CHIPS — only before the first real turn, and gone for good
            after it: `conversationStarted` is derived from the transcript, so a
            session restored from sessionStorage never shows them again either.
            Hidden while a reply is in flight so they cannot be double-tapped.

            `flex-wrap` with full-width chips below `sm`: on a phone they stack
            one per line at a full 44px-ish tap target rather than squeezing
            four Georgian phrases onto shared rows; from `sm` up they flow and
            wrap naturally. */}
        {!conversationStarted && !loading && (
          <div className="flex flex-wrap gap-2 pt-1">
            {CHAT_STARTERS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => send(q)}
                className="w-full sm:w-auto min-h-11 rounded-full border border-border bg-card px-3.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Composer — pinned to the bottom; pb honours the phone's home indicator. */}
      <div className="border-t border-border bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shrink-0">
        {/* Attachment preview / rejection notice, above the input row. */}
        {attachError && (
          <p className="px-1 pb-1.5 text-xs text-destructive">{attachError}</p>
        )}
        {attachment && !attachmentSent && (
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

        {/* Matched to the conversation column, not left full-width: the input
            is where the customer's own words go, so it lines up with the
            bubbles those words become. The bar itself stays edge-to-edge, so it
            still reads as docked chrome rather than a floating box. */}
        <div className="mx-auto w-full max-w-[44rem] flex items-center gap-2">
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
          // Wrapped: bare `onClick={send}` would hand send() the MouseEvent as
          // its new first argument.
          onClick={() => send()}
          disabled={loading || !input.trim()}
          aria-label={t(lang, "chat.send")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
        </button>
        </div>
      </div>

      {/* Sign-in from the order-status card. /chat is a full page, so the
          transcript restores visibly on its own after the OAuth redirect. */}
      <Suspense fallback={null}>
        <LoginModal
          open={showLogin}
          onClose={() => setShowLogin(false)}
          message={lang === "en" ? "Sign in to see your order" : "შედით შეკვეთის სანახავად"}
        />
      </Suspense>
    </div>
  );
}
