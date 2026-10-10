// Estimated USD cost of ONE gateway call, for the admin "AI ხარჯი" tab.
//
// ⚠️ THESE ARE PUBLIC LIST PRICES, NOT BILLED AMOUNTS. They are a per-call
// estimate taken from the providers' published price lists. The real bill
// depends on token counts, image sizes, retries the gateway absorbs and any
// gateway margin or discount, so the tab labels every figure as approximate.
// Nothing here is used for anything a customer pays.
//
// Keyed by the model string gemini-proxy writes to public.ai_calls.model. An
// action whose calls cost noticeably more or less than the model's typical
// call (e.g. a larger output image) can carry its own per-action override.
// A model missing from this table costs 0 and is flagged in the UI as
// "ტარიფი უცნობია" — add it here rather than guessing in the component.
//
// Update LAST_CHECKED whenever the numbers are re-checked against the lists.

export const LAST_CHECKED = "2026-10-10";

export interface ModelRate {
  /** Estimated USD per call. */
  perCall: number;
  /** Optional per-action estimate that replaces perCall for that action. */
  byAction?: Readonly<Record<string, number>>;
}

export const AI_COST_RATES: Readonly<Record<string, ModelRate>> = {
  "google/gemini-3-pro-image": { perCall: 0.134 },
  "google/gemini-2.5-flash-image": { perCall: 0.039 },
  "google/gemini-3-flash-preview": { perCall: 0.012 },
};

export interface CallRate {
  usd: number;
  /** false → model not in AI_COST_RATES; usd is 0 and the UI flags it. */
  known: boolean;
}

/** Estimated USD for one call of `model` made by `action`. */
export function rateFor(
  model: string,
  action: string,
  rates: Readonly<Record<string, ModelRate>> = AI_COST_RATES,
): CallRate {
  const rate = Object.prototype.hasOwnProperty.call(rates, model) ? rates[model] : undefined;
  if (!rate) return { usd: 0, known: false };
  const override = rate.byAction && Object.prototype.hasOwnProperty.call(rate.byAction, action)
    ? rate.byAction[action]
    : undefined;
  return { usd: override ?? rate.perCall, known: true };
}
