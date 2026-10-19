import { useEffect, useState } from "react";
import { Star, X } from "lucide-react";
import { COMMENT_BELOW_OR_AT, MAX_RATING_COMMENT, submitChatRating } from "@/lib/chatRating";

// Inline "rate this chat" card for ChatWidget and /chat. See lib/chatRating for
// when it appears and where the rating goes. Optional in every sense: it sits
// at the end of the transcript, never blocks anything, and × makes it go away
// for the rest of this conversation. Shown by useChatRatingPrompt.

export default function ChatRatingCard({
  sessionId,
  lang,
  onFinish,
  onClose,
}: {
  sessionId: string;
  lang: string;
  onFinish: (state: "rated" | "dismissed") => void;
  onClose: () => void;
}) {
  const en = lang === "en";
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [askComment, setAskComment] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thanked, setThanked] = useState(false);

  // The thank-you stays a few seconds, then the card leaves the transcript.
  useEffect(() => {
    if (!thanked) return;
    const id = window.setTimeout(onClose, 4000);
    return () => window.clearTimeout(id);
  }, [thanked, onClose]);

  const send = async (value: number, text: string | null) => {
    if (sending) return;
    setSending(true);
    setFailed(false);
    const res = await submitChatRating({ sessionId, rating: value, comment: text, lang });
    setSending(false);
    if (res === "error") {
      setFailed(true);
      return;
    }
    // ok / duplicate: recorded (now or earlier). no_session / invalid: the
    // server will never take it, so asking again would only nag.
    onFinish("rated");
    setThanked(true);
  };

  const pick = (value: number) => {
    if (sending || thanked) return;
    setRating(value);
    if (value <= COMMENT_BELOW_OR_AT) {
      setAskComment(true);
      return;
    }
    setAskComment(false);
    void send(value, null);
  };

  if (thanked) {
    return (
      <div className="rounded-2xl border border-border bg-card px-3 py-2.5 text-center text-sm text-foreground">
        {en ? "Thank you for the rating 🙏" : "მადლობა შეფასებისთვის 🙏"}
      </div>
    );
  }

  const shown = hover || rating;

  return (
    <div className="relative rounded-2xl border border-border bg-card px-3 py-2.5 text-sm">
      <button
        type="button"
        onClick={() => onFinish("dismissed")}
        aria-label={en ? "Close" : "დახურვა"}
        className="absolute top-1.5 right-1.5 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <p className="pr-6 text-foreground">
        {en ? "How helpful was this chat?" : "რამდენად დაგეხმარათ ეს საუბარი?"}
      </p>
      <div className="mt-1.5 flex items-center gap-1" role="radiogroup" aria-label={en ? "Rating" : "შეფასება"} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={rating === v}
            aria-label={en ? `${v} of 5` : `${v} 5-დან`}
            disabled={sending}
            onClick={() => pick(v)}
            onMouseEnter={() => setHover(v)}
            onFocus={() => setHover(v)}
            onBlur={() => setHover(0)}
            className="rounded-md p-0.5 transition-transform hover:scale-110 disabled:opacity-60"
          >
            <Star
              className={`h-6 w-6 ${v <= shown ? "fill-amber-400 text-amber-400" : "text-muted-foreground/50"}`}
            />
          </button>
        ))}
      </div>

      {askComment && (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={MAX_RATING_COMMENT}
            rows={2}
            placeholder={en ? "What was missing? (optional)" : "რა ვერ მიიღეთ? (სურვილისამებრ)"}
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-base sm:text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={() => send(rating, comment)}
            disabled={sending}
            className="w-full rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-60"
          >
            {sending ? (en ? "Sending…" : "იგზავნება…") : (en ? "Send" : "გაგზავნა")}
          </button>
        </div>
      )}

      {failed && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {en ? "Couldn't send — please try again." : "ვერ გაიგზავნა — სცადეთ ხელახლა."}
        </p>
      )}
    </div>
  );
}
