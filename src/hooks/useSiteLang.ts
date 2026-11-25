import type { Lang } from "@/lib/i18n";
import { useAppState } from "@/hooks/useAppState";

/**
 * The site language where a provider is not guaranteed (the showroom's pieces are
 * also rendered alone in tests and on the lab page): Georgian without one.
 * useAppState always makes its one context read before it throws, so the hook
 * order is the same on every render.
 */
export function useSiteLang(): Lang {
  try {
    return useAppState().lang;
  } catch {
    return "ge";
  }
}
