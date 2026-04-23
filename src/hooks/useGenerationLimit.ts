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

export function useGenerationLimit() {
  const { user } = useAuth();

  const checkLimit = useCallback((): LimitCheckResult => {
    // Guest user — 5 per 24h, then login required
    if (!user) {
      const data = getGuestLimit();
      const now = Date.now();
      // Reset if 24h window has passed
      if (data.count > 0 && now - data.firstGenAt >= GUEST_COOLDOWN_MS) {
        setGuestLimit({ count: 0, firstGenAt: 0 });
        return { allowed: true };
      }
      if (data.count >= GUEST_LIMIT) {
        return {
          allowed: false,
          reason: "guest_limit",
          message: "სტუმრის ლიმიტი ამოიწურა (5 გენერაცია 24 საათში). გასაგრძელებლად გთხოვთ დარეგისტრირდეთ.",
        };
      }
      return { allowed: true };
    }

    // Logged-in users have no generation limit
    return { allowed: true };
  }, [user]);

  const recordGeneration = useCallback(() => {
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
  }, [user]);

  return { checkLimit, recordGeneration };
}
