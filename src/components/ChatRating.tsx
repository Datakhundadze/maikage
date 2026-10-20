import { useEffect, useRef, useState } from "react";
import { Star, X } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import {
  MAX_RATING_COMMENT,
  isRatingDone,
  markRatingDone,
  shouldShowRating,
  submitChatRating,
} from "@/lib/chatRating";

// The end-of-conversation rating row, rendered as the LAST item of the message
// list in both ChatWidget and /chat (so it sits under the latest assistant
// reply). Add-only: it never touches sending, history or the composer.
//
// FLOW. stars → (tap) optional one-line comment with send / skip → thanks.
// The session is marked done in localStorage the moment a star is tapped (or ✕
// is pressed), so the row never comes back for that session_id. A tapped
// rating that was neither sent nor skipped is flushed ALONE when the row
// unmounts (widget closed/minimised, route change) or the page is hidden.
//
// Stays MOUNTED while hidden (`visible` false during a reply in flight), so a
// half-typed comment survives the customer sending another message.

type Phase = "stars" | "comment" | "thanks" | "closed";

interface Props {
  sessionId: string;
  lang: Lang;
  /** Real (non-local) assistant replies so far — see countAssistantReplies. */
  assistantReplies: number;
  /** False while a reply is in flight; the row hides but keeps its state. */
  visible?: boolean;
  /** Where the chat is, stored with the rating (e.g. location.pathname). */
  page?: string;
}

const copy = {
  ge: {
    question: "როგორ შეაფასებ ჩატს?",
    star: (n: number) => `${n} ვარსკვლავი`,
    dismiss: "დახურვა",
    placeholder: "რა გავაუმჯობესოთ?",
    send: "გაგზავნა",
    skip: "გამოტოვება",
    thanks: "გმადლობთ!",
  },
  en: {
    question: "How would you rate this chat?",
    star: (n: number) => (n === 1 ? "1 star" : `${n} stars`),
    dismiss: "Dismiss",
    placeholder: "What could we improve?",
    send: "Send",
    skip: "Skip",
    thanks: "Thank you!",
  },
} as const;

export default function ChatRating({ sessionId, lang, assistantReplies, visible = true, page }: Props) {
  const c = lang === "en" ? copy.en : copy.ge;
  // Read once per mount: a session already rated/dismissed never shows again.
  const [doneAtMount] = useState(() => isRatingDone(sessionId));
  const [phase, setPhase] = useState<Phase>("stars");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const rowRef = useRef<HTMLDivElement>(null);

  // The tapped-but-unsent rating. Read by the unmount/pagehide flush, so it is
  // a ref (the cleanup closes over the first render).
  const pending = useRef<{ rating: number } | null>(null);
  const meta = useRef({ sessionId, lang, page });
  meta.current = { sessionId, lang, page };

  const send = (withComment: string | null) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    void submitChatRating({
      sessionId: meta.current.sessionId,
      rating: p.rating,
      comment: withComment,
      lang: meta.current.lang,
      page: meta.current.page ?? null,
    });
  };

  useEffect(() => {
    const flush = () => send(null);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
    // send reads refs only; registering once is the point.
  }, []);

  // The row grows when the comment field opens — keep it in view.
  useEffect(() => {
    if (phase === "stars") return;
    const el = rowRef.current;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
  }, [phase]);

  if (phase === "closed") return null;
  if (phase === "stars" && !shouldShowRating(assistantReplies, doneAtMount)) return null;
  if (!visible) return null;

  const pick = (n: number) => {
    if (phase !== "stars") return;
    setRating(n);
    pending.current = { rating: n };
    markRatingDone(sessionId, "rated");
    setPhase("comment");
  };

  const dismiss = () => {
    markRatingDone(sessionId, "dismissed");
    setPhase("closed");
  };

  const finish = (withComment: boolean) => {
    send(withComment ? comment : null);
    setPhase("thanks");
  };

  const shown = phase === "stars" ? hover : rating;

  return (
    <div ref={rowRef} className="flex justify-start" data-testid="chat-rating">
      <div className="w-full max-w-[85%] rounded-2xl border border-border bg-card px-3 py-2 text-xs text-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{phase === "thanks" ? c.thanks : c.question}</span>
          {phase === "stars" && (
            <button
              type="button"
              onClick={dismiss}
              aria-label={c.dismiss}
              title={c.dismiss}
              className="-mr-1 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div
          className="mt-1 flex items-center gap-0.5"
          role="radiogroup"
          aria-label={c.question}
          onMouseLeave={() => setHover(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n <= shown;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={c.star(n)}
                disabled={phase !== "stars"}
                onClick={() => pick(n)}
                onMouseEnter={() => phase === "stars" && setHover(n)}
                className="flex h-8 w-8 items-center justify-center rounded-md transition-transform enabled:hover:scale-110 disabled:cursor-default"
              >
                <Star
                  className={`h-5 w-5 ${on ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        {phase === "comment" && (
          <div className="mt-1.5 space-y-1.5">
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, MAX_RATING_COMMENT))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  finish(true);
                }
              }}
              maxLength={MAX_RATING_COMMENT}
              placeholder={c.placeholder}
              aria-label={c.placeholder}
              className="w-full min-w-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-base sm:text-xs outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => finish(false)}
                className="rounded-lg px-2.5 py-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {c.skip}
              </button>
              <button
                type="button"
                onClick={() => finish(true)}
                disabled={!comment.trim()}
                className="rounded-lg bg-primary px-2.5 py-1 font-semibold text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {c.send}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
