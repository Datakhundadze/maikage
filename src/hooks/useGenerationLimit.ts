import { useCallback } from "react";
import { useAuth } from "./useAuth";

const STORAGE_KEY = "maika_gen_limit";
const LOGGED_IN_LIMIT = 3;
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const GUEST_LIMIT = 5;
const GUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
const GUEST_STORAGE_KEY = "maika_guest_gen_limit";

interface GenLimitData {
  count: number;
  firstGenAt: number;
}

function getStoredLimit(): GenLimitData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { count: 0, firstGenAt: 0 };
}

function setStoredLimit(data: GenLimitData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function getGuestLimit(): GenLimitData {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { count: 0, firstGenAt: 0 };
}

function setGuestLimit(data: GenLimitData) {
  localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(data));
}

export type LimitCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "guest_limit"; message: string }
  | { allowed: false; reason: "user_limit"; message: string };

// `guestLimit` defaults to the historical 5 so existing callers (Studio)
// are byte-for-byte unchanged; Simple-mode AI passes 2.
export function useGenerationLimit(guestLimit: number = GUEST_LIMIT) {
  const { user, loading } = useAuth();

  const checkLimit = useCallback((): LimitCheckResult => {
    // ── AUTH NOT SETTLED YET ────────────────────────────────────────────────
    // `user` is null for TWO different people: a real guest, and a signed-in
    // customer whose session is still being restored (useAuth starts at
    // { user: null, loading: true } and only resolves in getSession().then).
    // This code CAN run before that resolves, because AppRoutes returns the
    // "/" mode views — SimplePage among them — ABOVE its own
    // `if (loading)` gate. A chat handoff opens the constructor in a fresh tab
    // and its seeded generation fires within a few commits, comfortably inside
    // that window.
    //
    // Reading that null as "guest" charged registered customers against the
    // GUEST key, and once it reached the limit it locked them out of a product
    // they had signed up for, for 24 hours, with a modal telling them to sign
    // up. So: while loading we allow, and recordGeneration below writes
    // nothing.
    //
    // This is safe because this gate was never the enforcement. It exists to
    // raise the login modal at the right moment; the counter behind it lives in
    // localStorage and anyone can clear it. The real ceiling is server-side and
    // entirely unaffected — gemini-proxy keys anonymous callers by IP at 2/hour
    // and 5/day and checks it on every billable action, whatever the client
    // believed.
    if (loading) return { allowed: true };

    // Guest user — `guestLimit` per 24h, then login required
    if (!user) {
      const data = getGuestLimit();
      const now = Date.now();
      // Reset if 24h window has passed
      if (data.count > 0 && now - data.firstGenAt >= GUEST_COOLDOWN_MS) {
        setGuestLimit({ count: 0, firstGenAt: 0 });
        return { allowed: true };
      }
      if (data.count >= guestLimit) {
        return {
          allowed: false,
          reason: "guest_limit",
          message: `სტუმრის ლიმიტი ამოიწურა (${guestLimit} გენერაცია 24 საათში). გასაგრძელებლად გთხოვთ დარეგისტრირდეთ.`,
        };
      }
      return { allowed: true };
    }

    // Logged-in users have no generation limit
    return { allowed: true };
  }, [user, loading, guestLimit]);

  const recordGeneration = useCallback(() => {
    // Same window, same reason as checkLimit: a null user here is not yet KNOWN
    // to be a guest, and writing the guest counter for a signed-in customer is
    // precisely the bug. Skip the write rather than guess — the server has
    // already counted this call against the right key.
    if (loading) return;

    if (!user) {
      const data = getGuestLimit();
      const now = Date.now();
      if (data.count > 0 && now - data.firstGenAt >= GUEST_COOLDOWN_MS) {
        setGuestLimit({ count: 1, firstGenAt: now });
        return;
      }
      setGuestLimit({
        count: data.count + 1,
        firstGenAt: data.firstGenAt || now,
      });
      return;
    }

    const data = getStoredLimit();
    const now = Date.now();

    // Reset if cooldown passed
    if (data.count > 0 && now - data.firstGenAt >= COOLDOWN_MS) {
      setStoredLimit({ count: 1, firstGenAt: now });
      return;
    }

    setStoredLimit({
      count: data.count + 1,
      firstGenAt: data.firstGenAt || now,
    });
  }, [user, loading]);

  return { checkLimit, recordGeneration };
}
