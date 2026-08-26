import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MessageCircle, X, Minus, ChevronUp, Send, ImagePlus } from "lucide-react";
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
// The photo-upload nudge: the event name, the once-per-session flag and the
// wording all live together, away from this component.
import {
  PHOTO_UPLOADED_EVENT,
  restyleOfferAlreadyShown,
  markRestyleOfferShown,
  restyleOfferText,
} from "@/lib/photoRestyleOffer";
// Shared with /chat — same parse, same precedence, same button.
import {
  type ChatSuggestion,
  type GenerateSuggestion,
  parseChatSuggestion,
  openGenerateInConstructor,
} from "@/lib/generateSuggestion";
import ChatSuggestionActions from "@/components/ChatSuggestionActions";
import ChatMarkdown from "@/components/ChatMarkdown";
// Only mounted once the order-status card's sign-in button is pressed, so the
// chat bundle does not carry the auth UI for every visitor. Same lazy treatment
// AppHeader gives it.
const LoginModal = lazy(() => import("@/components/LoginModal"));

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

// The unread badge — rendered on the collapsed launcher and on the minimised
// bar, which are the only two surfaces that can carry it.
//
// ⚠️ THE DIGIT IS LITERALLY "1", AND THERE IS NO COUNTER. The offer it announces
// fires exactly once per session (see photoRestyleOffer), so a count would be
// machinery with nothing to count — a `count` prop here would be an invitation
// to wire one up, and there is nothing to wire. If a second notification ever
// exists, that is the moment to add one, not before.
//
// WHY A DIGIT AT ALL. A bare dot reads as a status light — "something is on" —
// and gets scanned past. The numeral is the convention every messaging app has
// already taught the customer, and it says the one thing the dot did not: there
// is a message waiting to be read.
//
// The caller owns SIZE, POSITION and RING, because those differ per surface and
// nothing here can know them: the launcher's sits proud of a round button and
// needs the ring of page colour behind it; the bar's sits inline in a row of
// 16px icons on the accent fill, where a `ring-background` would be a halo of
// the wrong colour. What is shared is the part that must not drift — the fill,
// the shape, the centring of the glyph and the play-once entrance.
//
// ONE-SHOT ENTRANCE, not a loop: zoom-in plays once on appearance. A badge that
// pulses forever is an alarm, and gets ignored like one.
function UnreadBadge({ className }: { className: string }) {
  return (
    // aria-hidden because the surfaces carry their own sr-only wording; a
    // screen reader announcing a bare "1" next to it would be noise.
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-full bg-red-500 font-bold text-white tabular-nums animate-in zoom-in-50 duration-300 ${className}`}
    >
      1
    </span>
  );
}

export default function ChatWidget() {
  const { lang, setMode } = useAppState();
  const navigate = useNavigate();
  const location = useLocation();
  // Restored transcript, read ONCE at mount. A photo's bytes are never
  // persisted, so a turn that carried one comes back as `hadImage` and renders
  // a placeholder instead of the picture.
  const restored = useMemo(() => loadChat("widget"), []);
  // Reopen automatically when the panel was open before a document navigation.
  //
  // The transcript already survived that navigation; the OPEN FLAG did not, so
  // a customer who signed in with Google/Apple — a full same-tab redirect —
  // came back to a closed bubble with their conversation hidden behind it.
  // Indistinguishable from having lost it. That seam matters now that signing
  // in is a step inside the order-status conversation itself.
  const [open, setOpen] = useState(() => restored?.open === true);
  // Collapsed-to-the-header-bar state. Purely presentational: the panel stops
  // being rendered but every piece of chat state below stays put, so expanding
  // restores the same conversation, the same attachment and the same session.
  const [minimized, setMinimized] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
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
  // Downscaled data URL of the attached photo. Retained after sending so the
  // "ესკიზის ნახვა" handoff can still use it; only the preview is hidden.
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachmentSent, setAttachmentSent] = useState(false);
  // One stable id per widget mount so the server can group this conversation
  // in the admin chat-history log. Resets on reload (a new visit = new session).
  // Reuse the RESTORED session id so a reloaded conversation keeps grouping
  // under one id in the admin chat log instead of splitting in two.
  const sessionIdRef = useRef<string>(restored?.sessionId ?? crypto.randomUUID());

  // Keep the list pinned to the newest message / typing indicator. `minimized`
  // is a dependency because collapsing unmounts the list — on expand the fresh
  // node starts at scrollTop 0 and has to be re-pinned to the bottom.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open, minimized]);
  // Persist on every change. Deliberately mirrors state rather than hooking
  // each mutation site, so no future path can forget to save. The image data
  // URL is dropped here — see chatPersistence for why.
  //
  // `open` is a dependency so closing the panel is written too — otherwise a
  // deliberate close would be forgotten and the widget would spring back open
  // on the next navigation.
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
    saveChat("widget", sessionIdRef.current, slim, open);
  }, [messages, open]);


  // ── The photo nudge ──────────────────────────────────────────────────────
  //
  // A red dot on the collapsed launcher, and an assistant bubble waiting inside
  // when it is opened. Both are LOCAL: the bubble is pushed straight into the
  // transcript with `local: true`, so it costs nothing, makes no request, and
  // is never parsed for fenced blocks — parsing only happens inside send(),
  // which this never touches.
  //
  // ONCE PER SESSION, ENFORCED IN ONE PLACE. The flag is set the moment the
  // offer is made by EITHER route, so a second upload finds it set and does
  // nothing, and clearing the dot cannot bring it back. The listener re-reads
  // the flag rather than trusting component state, so a remount cannot reopen
  // the door either.
  const [showPhotoDot, setShowPhotoDot] = useState(false);

  const seedRestyleOffer = useCallback(() => {
    setMessages((prev) => [
      ...prev,
      // Seeded AFTER the greeting if one is already there, and standing alone
      // if the customer has never opened the panel — the greeting is seeded by
      // openPanel only when the transcript is empty, so it cannot land twice.
      { role: "assistant", content: restyleOfferText(lang), local: true },
    ]);
  }, [lang]);

  useEffect(() => {
    const onPhoto = () => {
      if (restyleOfferAlreadyShown()) return;
      markRestyleOfferShown();
      // PANEL ALREADY OPEN → no dot, because a badge on a launcher the customer
      // is not looking at is pointless; they are already in the chat, so the
      // offer goes straight in where they will see it now. Either way the
      // session flag is spent, so this happens exactly once.
      if (open && !minimized) {
        seedRestyleOffer();
        return;
      }
      setShowPhotoDot(true);
    };
    window.addEventListener(PHOTO_UPLOADED_EVENT, onPhoto);
    return () => window.removeEventListener(PHOTO_UPLOADED_EVENT, onPhoto);
  }, [open, minimized, seedRestyleOffer]);

  // Clearing the dot and putting the offer in front of the customer are one
  // act, and it happens whichever collapsed affordance they tapped — the round
  // launcher or the minimised bar. The dot never comes back: the session flag
  // was already spent when it appeared.
  const revealPhotoOffer = useCallback(() => {
    if (!showPhotoDot) return;
    setShowPhotoDot(false);
    seedRestyleOffer();
  }, [showPhotoDot, seedRestyleOffer]);

  const openPanel = useCallback(() => {
    setOpen(true);
    // Seed a local bilingual greeting on first open (no API call).
    setMessages((prev) => (prev.length === 0 ? [{ role: "assistant", content: t(lang, "chat.greeting"), local: true }] : prev));
    // After the greeting, so on a first-ever open it reads as a follow-on
    // rather than as the first thing the assistant says. Both are functional
    // updates, so React applies them in this order.
    revealPhotoOffer();
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [lang, revealPhotoOffer]);

  const send = useCallback(async () => {
    const text = input.trim();
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
    // FREE SKETCH → SHOW IT, don't ask for a click. Returns true only when a
    // constructor is mounted in THIS tab AND the block spends no generation;
    // every other case is false and the button below renders as it always has.
    const autoApplied = tryAutoOpenSketch(suggestion, sentAttachment) || undefined;
    setMessages((prev) => [...prev, { role: "assistant", content: reply, local, suggestion, autoApplied }]);
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
        {/* Sits on the launcher's top-right edge, 2px proud of a 56px circle
            that is itself 16px off the viewport corner — so it never reaches an
            edge and never covers the icon, at mobile size as at desktop (the
            launcher is h-14 at every breakpoint). The ring is the page behind
            it, which is what makes it read as a badge rather than a mark
            painted on the button.

            18px, WHICH IS WHAT ONE DIGIT NEEDS and not a pixel more — it grew
            from the 14px dot only far enough to hold a 10px numeral with even
            space around it. It is still a badge, not a button: nothing here is
            tappable in its own right, the whole launcher is the target. The
            offsets are unchanged from the dot, so the extra 4px grows inward,
            AWAY from the viewport corner. Both circles stay clear of the icon —
            centres 29.7px apart against 22px of combined radius. */}
        {showPhotoDot && (
          <UnreadBadge className="absolute -top-0.5 -right-0.5 h-[18px] w-[18px] text-[10px] leading-none ring-2 ring-background" />
        )}
        {showPhotoDot && (
          <span className="sr-only">
            {lang === "en" ? "New message" : "ახალი შეტყობინება"}
          </span>
        )}
      </button>
    );
  }

  // ── Open but minimized: the header bar alone, pinned bottom-right ──
  // Anchored exactly where the round launcher sits, so it covers nothing the
  // launcher does not already cover, and capped at the panel's own 360px.
  // Tapping anywhere on the bar expands the panel back, untouched.
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => { setMinimized(false); revealPhotoOffer(); }}
        aria-label={lang === "en" ? "Expand chat" : "ჩატის გაშლა"}
        title={lang === "en" ? "Expand chat" : "ჩატის გაშლა"}
        className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 flex w-[calc(100vw-2rem)] max-w-[360px] items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left text-white shadow-2xl"
        style={{ backgroundColor: ACCENT }}
      >
        <span className="flex items-center gap-2 min-w-0">
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold truncate">{t(lang, "chat.title")}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {/* Same badge on the minimised bar: while minimised the launcher is
              not rendered, so without this the badge would have nowhere to show
              and the nudge would be silent until the customer expanded anyway.

              SMALLER THAN THE LAUNCHER'S, AND STILL LEGIBLE — 16px against 18px.
              It sits inline in a row whose other glyph is a 16px chevron, so
              matching that is what keeps the row from looking lopsided; the
              digit is the SAME 10px as on the launcher, which is the part that
              had to survive the shrink. Only the ring is dropped, and only
              because there is nothing here for it to be a ring of: the bar's
              fill is the accent green, not the page, so `ring-background` would
              draw a halo of a colour that is nowhere near it. Red on that green
              separates on its own. */}
          {showPhotoDot && (
            <UnreadBadge className="h-4 w-4 shrink-0 text-[10px] leading-none" />
          )}
          <ChevronUp className="h-4 w-4 shrink-0" />
        </span>
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
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setMinimized(true)}
            aria-label={lang === "en" ? "Minimize chat" : "ჩატის ჩაკეცვა"}
            className="rounded-md p-1 hover:bg-white/20 transition-colors"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t(lang, "chat.close")}
            className="rounded-md p-1 hover:bg-white/20 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
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
              {/* The customer's own photo, confirming it was received. Sizing
                  matches SimpleAiChatPanel's result bubbles (max-h, w-auto,
                  object-contain, rounded-lg). A restored-from-storage bubble
                  has no data URL and falls to the placeholder below. */}
              {m.role === "user" && m.image && (
                <img
                  src={m.image}
                  alt={lang === "en" ? "Attached photo" : "მიმაგრებული ფოტო"}
                  className="mt-1.5 max-h-40 w-auto rounded-lg object-contain"
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
              {/* Only for a fully-validated suggestion; a failed parse leaves
                  it undefined and the prose stands alone. */}
              <ChatSuggestionActions
                suggestion={m.suggestion}
                autoApplied={m.autoApplied}
                lang={lang}
                compact
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

      {/* Sign-in from the order-status card. The transcript is already
          persisted, and the panel's open state now is too, so both the
          email/password path (no navigation) and the Google/Apple path (a
          full same-tab redirect) come back to this same open conversation. */}
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
