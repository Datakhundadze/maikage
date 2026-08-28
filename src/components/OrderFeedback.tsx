import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { submitFeedback, MAX_FEEDBACK_MESSAGE } from "@/lib/feedback";

// Optional post-order feedback, rendered on the confirmation page.
//
// WHY IT LIVES HERE AND NOT IN THE PAGE. Everything it needs is local: the
// draft text, the submitting flag, the sent flag, the error. Keeping that state
// inside this component means the confirmation page never re-renders because
// someone is typing — which matters, because the page carries a GA4 `purchase`
// conversion keyed on [paymentState, orderId, isLoggedIn, groups] and a
// 60-second payment poll. This component reads `orderId` as a PROP from state
// the page already holds and touches nothing else; state flows down only, so it
// cannot reach the effects above it.
//
// The converse also holds, and is the reason for a child rather than inline
// JSX: the page re-renders roughly every 3 seconds while the poll runs, and a
// child's own state survives its parent re-rendering. Typed text is safe across
// all twenty ticks.
//
// ⚠️ OPTIONAL MEANS OPTIONAL. No required attribute, no validation message, no
// error styling, no nag. An empty field is the ordinary outcome and produces
// nothing at all — the send button is simply inert until there are words. The
// customer has already paid; this is an invitation, not a step. (The footer
// modal DOES toast on an empty message; that is deliberate there, where sending
// feedback is the entire purpose of opening it, and deliberately absent here.)
export default function OrderFeedback({ orderId }: { orderId: string | null }) {
  const { lang } = useAppState();
  const { user } = useAuth();
  const location = useLocation();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleSend = async () => {
    const msg = message.trim();
    if (!msg || submitting) return;
    setSubmitting(true);
    setFailed(false);
    // The insert cannot throw out of here: submitFeedback returns its error.
    // Nothing in this handler touches payment state, navigation or the order.
    const { error } = await submitFeedback({
      message: msg,
      page: location.pathname,
      userId: user?.id ?? null,
      orderId,
    });
    setSubmitting(false);
    if (error) {
      // Never silent. They wrote something; they are told it did not send and
      // the form stays exactly as it was so they can send it again.
      setFailed(true);
      return;
    }
    setSent(true);
  };

  // Replaced by the thank-you, so the same message cannot be sent twice.
  if (sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm text-foreground">
          {lang === "en" ? "Thank you — we've read it 🙏" : "მადლობა — წავიკითხავთ 🙏"}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">
        {/* Formal register (თქვენ), matching the confirmation page it sits on. */}
        {lang === "en" ? "Anything you'd like to tell us?" : "გვინდა თქვენი აზრი"}
      </p>
      <p className="text-xs text-muted-foreground">
        {lang === "en" ? "Optional — it helps us get better." : "სურვილისამებრ — დაგვეხმარება გავუმჯობესდეთ."}
      </p>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={MAX_FEEDBACK_MESSAGE}
        rows={3}
        placeholder={lang === "en" ? "How did it go?" : "როგორ ჩაიარა?"}
        className="text-sm"
      />
      {failed && (
        <p className="text-xs text-muted-foreground">
          {lang === "en"
            ? "Couldn't send — please try again."
            : "ვერ გაიგზავნა — სცადეთ ხელახლა."}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={handleSend}
        disabled={submitting || !message.trim()}
      >
        {submitting
          ? (lang === "en" ? "Sending…" : "იგზავნება…")
          : (lang === "en" ? "Send" : "გაგზავნა")}
      </Button>
    </div>
  );
}
