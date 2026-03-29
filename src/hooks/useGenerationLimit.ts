import { useCallback } from "react";
import { useAuth } from "./useAuth";

const STORAGE_KEY = "maika_gen_limit";
const LOGGED_IN_LIMIT = 3;
const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const GUEST_LIMIT = 1;
const GUEST_STORAGE_KEY = "maika_guest_gen_count";

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

function getGuestCount(): number {
  try {
    return parseInt(localStorage.getItem(GUEST_STORAGE_KEY) || "0", 10);
  } catch {
    return 0;
  }
}

function setGuestCount(n: number) {
  localStorage.setItem(GUEST_STORAGE_KEY, String(n));
}

export type LimitCheckResult =
  | { allowed: true }
  | { allowed: false; reason: "guest_limit"; message: string }
  | { allowed: false; reason: "user_limit"; message: string };

export function useGenerationLimit() {
  const { user } = useAuth();

  const checkLimit = useCallback((): LimitCheckResult => {
    // Guest user
    if (!user) {
      const count = getGuestCount();
      if (count >= GUEST_LIMIT) {
        return {
          allowed: false,
          reason: "guest_limit",
          message: "გასაგრძელებლად გთხოვთ დარეგისტრირდეთ",
        };
      }
      return { allowed: true };
    }

    // Logged-in users have no generation limit
    return { allowed: true };
  }, [user]);

  const recordGeneration = useCallback(() => {
    if (!user) {
      setGuestCount(getGuestCount() + 1);
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
