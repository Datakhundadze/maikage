import { useCallback, useEffect, useState } from "react";
import { IDLE_MS, isRatingEligible, readRatingState, writeRatingState } from "@/lib/chatRating";

// When to show ChatRatingCard (ChatWidget and /chat). See lib/chatRating.

interface Msg {
  role: "user" | "assistant";
  local?: boolean;
}

/**
 * Whether to show the card now. Becomes true after IDLE_MS of quiet once the
 * conversation is eligible; a new message from either side resets the clock
 * (and hides the card while the conversation is moving again).
 */
export function useChatRatingPrompt(sessionId: string, messages: Msg[], loading: boolean) {
  // A session rated or dismissed earlier in this tab never sees the card.
  const [done, setDone] = useState(() => readRatingState(sessionId) !== null);
  // Rated just now: the card stays (showing the thank-you) until close().
  const [rated, setRated] = useState(false);
  const [visible, setVisible] = useState(false);
  const eligible = !done && !rated && isRatingEligible(messages, loading);
  const count = messages.length;

  useEffect(() => {
    if (rated) return; // keep the thank-you on screen whatever happens next
    setVisible(false);
    if (!eligible) return;
    const id = window.setTimeout(() => setVisible(true), IDLE_MS);
    return () => window.clearTimeout(id);
  }, [eligible, count, rated]);

  /** Rated, or ×'d: never offer again for this session. */
  const finish = useCallback((state: "rated" | "dismissed") => {
    writeRatingState(sessionId, state);
    if (state === "dismissed") setDone(true);
    else setRated(true);
  }, [sessionId]);
  /** Called once the thank-you has been seen, to remove the card. */
  const close = useCallback(() => setDone(true), []);

  return { show: visible && !done, finish, close };
}

