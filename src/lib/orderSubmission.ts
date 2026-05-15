import { supabase } from "@/integrations/supabase/client";
import type { DesignState } from "@/lib/designState";
import type { PaymentMethod } from "@/components/PaymentMethodSelector";

// Shared order-submission primitives used by both checkout paths.
// Extracts the steps that were previously duplicated between
// OrderDialog.handleSubmit and CartPage.handleCheckout: design_state URL
// merging, the back_transparent_image_url backfill, and the
// create-payment edge function invocation with error normalization.

/** Splices upload-returned URLs into the photo entries of a DesignState. */
export function mergeDesignStateUrls(
  designState: DesignState | null,
  frontOriginalUrls: (string | null)[],
  backOriginalUrls: (string | null)[],
): DesignState | null {
  if (!designState) return null;
  return {
    ...designState,
    front: designState.front
      ? {
          ...designState.front,
          photos: designState.front.photos.map((p, i) => ({ ...p, url: frontOriginalUrls[i] ?? null })),
        }
      : null,
    back: designState.back
      ? {
          ...designState.back,
          photos: designState.back.photos.map((p, i) => ({ ...p, url: backOriginalUrls[i] ?? null })),
        }
      : null,
  };
}

/**
 * Populates back_transparent_image_url after insert. Kept separate from
 * the insert payload because the Supabase generated Database type is
 * frequently stale relative to the schema; keeping this as an
 * `as any` update preserves the defensive behavior of the previous
 * implementation.
 */
export async function backfillBackTransparentImageUrl(
  orderIds: string[],
  url: string | null,
): Promise<void> {
  if (!url || orderIds.length === 0) return;
  const { error } = await supabase
    .from("orders")
    .update({ back_transparent_image_url: url } as any)
    .in("id", orderIds);
  if (error) {
    console.warn("[orderSubmission] back_transparent_image_url update skipped:", error.message);
  }
}

export interface PaymentInvocationParams {
  paymentMethod: PaymentMethod;
  orderId: string;
  amount: number;
  description: string;
  cartId?: string;
}

/**
 * Invokes the create-payment or create-payment-flitt edge function and
 * returns the redirect URL. Throws on any error path with a normalized
 * message extracted from the function's response body when available.
 */
export async function invokePaymentRedirect(params: PaymentInvocationParams): Promise<string> {
  const payFn = params.paymentMethod === "bog" ? "create-payment" : "create-payment-flitt";
  const body: Record<string, unknown> = {
    orderId: params.orderId,
    amount: params.amount,
    description: params.description,
  };
  if (params.cartId) body.cartId = params.cartId;

  const paymentRes = await supabase.functions.invoke(payFn, { body });

  if (paymentRes.error) {
    let detail = paymentRes.error.message || "Payment creation failed";
    const ctx = (paymentRes.error as any).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const errBody = await ctx.json();
        if (errBody?.error) {
          detail = typeof errBody.error === "string" ? errBody.error : JSON.stringify(errBody.error);
        }
      } catch {
        try {
          const text = await ctx.text();
          if (text) detail = text;
        } catch {}
      }
    }
    throw new Error(detail);
  }

  const { redirect_url } = paymentRes.data as { redirect_url?: string };
  if (!redirect_url) throw new Error("No redirect URL received from payment provider");
  return redirect_url;
}

/** Anything castable to orders.insert; using `unknown` so callers don't have to fight the stale generated type. */
type OrderRow = Record<string, unknown>;

export interface SubmitOrderParams {
  /** Rows to insert into orders. Each row must include an `id` field. */
  rows: OrderRow[];
  /** The id used to invoke payment (typically rows[0].id). */
  paymentOrderId: string;
  /** Total to charge (in GEL). */
  amount: number;
  description: string;
  paymentMethod: PaymentMethod;
  /** Optional cart_id for cart-grouped checkout. */
  cartId?: string;
  /** Optional per-row back_transparent_image_url backfill (orderId → url). */
  backTransparentBackfill?: { orderIds: string[]; url: string }[];
}

/**
 * High-level checkout helper: inserts orders, applies any
 * back_transparent_image_url backfills, then calls the payment provider
 * and returns the redirect URL. Throws on any failure so the caller can
 * surface a toast and stop.
 */
export async function submitOrder(params: SubmitOrderParams): Promise<string> {
  const { error } = await supabase.from("orders").insert(params.rows as any);
  if (error) throw new Error(error.message);

  if (params.backTransparentBackfill) {
    for (const entry of params.backTransparentBackfill) {
      await backfillBackTransparentImageUrl(entry.orderIds, entry.url);
    }
  }

  return invokePaymentRedirect({
    paymentMethod: params.paymentMethod,
    orderId: params.paymentOrderId,
    amount: params.amount,
    description: params.description,
    cartId: params.cartId,
  });
}
