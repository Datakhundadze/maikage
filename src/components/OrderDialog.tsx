import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShoppingBag } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/gtag";

import type { PriceBreakdown } from "@/lib/pricing";
import type { DesignState } from "@/lib/designState";
import { uploadBlobWithRetry, dataUrlToBlob } from "@/lib/uploadWithRetry";
import { mergeDesignStateUrls, submitOrder } from "@/lib/orderSubmission";
import PaymentMethodSelector, { type PaymentMethod } from "@/components/PaymentMethodSelector";

type DeliveryType = "pickup" | "courier_tbilisi" | "courier_outside";

const DELIVERY_PRICES: Record<DeliveryType, number> = {
  pickup: 0,
  courier_tbilisi: 8,
  courier_outside: 12,
};

const DELIVERY_LABELS: Record<DeliveryType, string> = {
  pickup: "მაღაზიიდან გატანა (უფასო)",
  courier_tbilisi: "კურიერი თბილისში (+8 ₾)",
  courier_outside: "კურიერი რეგიონში (+12 ₾)",
};

interface OrderDialogProps {
  breakdown: PriceBreakdown;
  product: string;
  subProduct: string;
  color: string;
  isStudio: boolean;
  children?: React.ReactNode;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  frontMockupDataUrl?: string | null;
  backMockupDataUrl?: string | null;
  transparentImageDataUrl?: string | null;
  backTransparentImageDataUrl?: string | null;
  frontOriginalPhotos?: string[];
  backOriginalPhotos?: string[];
  prompt?: string | null;
  /** Structured editor state — photos[].url is filled in after originals
   *  upload completes. Null when there's nothing to render. */
  designState?: DesignState | null;
  onBeforeOpen?: () => void;
  size?: string;
  /** How many units to order. Defaults to 1. Clamped to >= 1 internally
   *  so a stray 0 / negative / non-integer can never reach the payment
   *  amount calculation. */
  quantity?: number;
}

// Throws on persistent failure (after one retry) so the order can abort
// instead of being saved with a NULL print-file URL. The customer sees a
// toast and their payment is not initiated.
async function uploadMockupImage(dataUrl: string, orderId: string, side: string): Promise<string> {
  const blob = await dataUrlToBlob(dataUrl);
  console.log(`[OrderDialog] Uploading ${side} mockup: ${blob.size} bytes`);
  // Random segment makes the object path unguessable: the storage INSERT
  // policy allows any anon/authed caller to write under order-mockups/, so a
  // predictable `${orderId}-${side}.png` could be pre-created or targeted by
  // anyone who learned an order id. Nothing downstream parses this filename —
  // the resulting public URL is stored in front_mockup_url / back_mockup_url
  // and every reader (admin, order cards, emails) uses that column.
  const path = `order-mockups/${orderId}-${side}-${crypto.randomUUID()}.png`;
  const { publicUrl } = await uploadBlobWithRetry("designs", path, blob, { contentType: "image/png" });
  console.log(`[OrderDialog] ${side} mockup uploaded:`, publicUrl);
  return publicUrl;
}

// Upload full-resolution originals so admin can download the user's raw photos.
// Best-effort with one retry: a failed original returns null in design_state
// but does NOT abort the order — admin can recover from the rendered mockup
// or ask the customer to re-upload.
async function uploadOriginalPhotos(photos: string[], orderId: string, side: "front" | "back"): Promise<(string | null)[]> {
  return Promise.all(photos.map(async (dataUrl, i) => {
    try {
      const blob = await dataUrlToBlob(dataUrl);
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      const path = `order-originals/${orderId}/${side}-${i}.${ext}`;
      const { publicUrl } = await uploadBlobWithRetry("designs", path, blob, { contentType: blob.type });
      return publicUrl;
    } catch (e) {
      console.error(`[OrderDialog] best-effort original ${side}-${i} failed:`, e);
      return null;
    }
  }));
}

// Upload try-on assets (person photo + result) so admin can see who placed
// the order and what the try-on looked like. Stored under a `tryon-*` name
// so they sort separately from regular originals in the admin list.
// Best-effort: a failure is logged but never aborts the order.
async function uploadTryOnAssets(orderId: string): Promise<void> {
  const stash = [
    { key: "maika-tryon-person", filename: "tryon-person" },
    { key: "maika-tryon-result", filename: "tryon-result" },
  ];
  await Promise.all(stash.map(async ({ key, filename }) => {
    try {
      const dataUrl = sessionStorage.getItem(key);
      if (!dataUrl) return;
      const blob = await dataUrlToBlob(dataUrl);
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      const path = `order-originals/${orderId}/${filename}.${ext}`;
      await uploadBlobWithRetry("designs", path, blob, { contentType: blob.type });
      sessionStorage.removeItem(key);
    } catch (e) {
      console.error(`[OrderDialog] best-effort ${filename} failed:`, e);
    }
  }));
}

export default function OrderDialog({ breakdown, product, subProduct, color, isStudio, children, externalOpen, onExternalOpenChange, frontMockupDataUrl, backMockupDataUrl, transparentImageDataUrl, backTransparentImageDataUrl, frontOriginalPhotos, backOriginalPhotos, prompt, designState, onBeforeOpen, size, quantity }: OrderDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [internalOpen, setInternalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = (val: boolean) => {
    if (val && onBeforeOpen) onBeforeOpen();
    if (onExternalOpenChange) onExternalOpenChange(val);
    else setInternalOpen(val);
  };

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [delivery, setDelivery] = useState<DeliveryType>("pickup");
  const [address, setAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bog");

  // SAFETY INVARIANT: the displayed "სულ" below and the `amount` sent to
  // the payment edge function MUST both derive from this single variable.
  // Do not introduce a separate calculation for display vs amount — they
  // would drift out of sync and either undercharge or overcharge.
  const qty = Math.max(1, Math.floor(quantity ?? 1));
  const deliveryPrice = DELIVERY_PRICES[delivery];
  const productSubtotal = breakdown.total * qty;
  const totalWithDelivery = productSubtotal + deliveryPrice;

  // GA4 funnel: begin_checkout fires once each time the dialog opens (delivery
  // isn't chosen yet, so value = product subtotal). Ref guards re-renders while
  // open; resets on close so a re-open re-fires. Defensive — no-ops if no gtag.
  const checkoutTrackedRef = useRef(false);
  useEffect(() => {
    if (!open) { checkoutTrackedRef.current = false; return; }
    if (checkoutTrackedRef.current) return;
    checkoutTrackedRef.current = true;
    trackEvent("begin_checkout", {
      currency: "GEL",
      value: productSubtotal,
      items: [{
        item_name: [product, subProduct, color].filter(Boolean).join(" "),
        item_category: product,
        price: breakdown.total,
        quantity: qty,
      }],
    });
  }, [open, productSubtotal, product, subProduct, color, breakdown.total, qty]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Inline validation with focus + toast so the user sees exactly what's
    // missing instead of a silently-disabled button (which read as "the
    // order button disappeared" once a courier option was selected).
    const focusField = (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      el?.focus();
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    if (!firstName.trim()) { toast({ title: "შეიყვანე სახელი", variant: "destructive" }); focusField("firstName"); return; }
    if (!lastName.trim()) { toast({ title: "შეიყვანე გვარი", variant: "destructive" }); focusField("lastName"); return; }
    if (!email.trim()) { toast({ title: "შეიყვანე ელფოსტა", variant: "destructive" }); focusField("email"); return; }
    if (!phone.trim()) { toast({ title: "შეიყვანე ტელეფონი", variant: "destructive" }); focusField("phone"); return; }
    if (delivery !== "pickup" && !address.trim()) {
      toast({ title: "შეიყვანე მიწოდების მისამართი", variant: "destructive" });
      focusField("address");
      return;
    }
    setSubmitting(true);

    try {
      const orderId = crypto.randomUUID();

      // Upload mockup images and full-resolution originals in parallel
      const [frontUrl, backUrl, transparentUrl, backTransparentUrl, frontOriginalUrls, backOriginalUrls] = await Promise.all([
        frontMockupDataUrl ? uploadMockupImage(frontMockupDataUrl, orderId, "front") : Promise.resolve(null),
        backMockupDataUrl ? uploadMockupImage(backMockupDataUrl, orderId, "back") : Promise.resolve(null),
        transparentImageDataUrl ? uploadMockupImage(transparentImageDataUrl, orderId, "transparent") : Promise.resolve(null),
        backTransparentImageDataUrl ? uploadMockupImage(backTransparentImageDataUrl, orderId, "transparent-back") : Promise.resolve(null),
        frontOriginalPhotos?.length ? uploadOriginalPhotos(frontOriginalPhotos, orderId, "front") : Promise.resolve([] as (string | null)[]),
        backOriginalPhotos?.length ? uploadOriginalPhotos(backOriginalPhotos, orderId, "back") : Promise.resolve([] as (string | null)[]),
        uploadTryOnAssets(orderId),
      ]);

      // Merge upload URLs into design_state so admin can re-render. Photos
      // with a failed upload land with url=null — the coords are still
      // preserved so the customer can re-upload manually.
      const finalDesignState: DesignState | null = mergeDesignStateUrls(
        designState ?? null,
        frontOriginalUrls,
        backOriginalUrls,
      );

      // Mirror CartPage's expand-by-quantity pattern (CartPage.tsx:179-218):
      // build one rowTemplate, then create `qty` rows sharing the same
      // mockup URLs and (when qty > 1) a cart_id so admin groups them.
      // `orderId` is reused as rows[0].id so the upload paths above and
      // localStorage / payment / redirect all key off the same row.
      const cartId = qty > 1 ? crypto.randomUUID() : null;
      const rowTemplate = {
        user_id: user?.id || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        comment: comment.trim() || null,
        phone: phone.trim(),
        delivery_type: delivery,
        delivery_address: delivery !== "pickup" ? address.trim() : null,
        delivery_price: 0,
        product_price: breakdown.total,
        total_price: breakdown.total,
        product,
        sub_product: subProduct,
        color,
        is_studio: isStudio,
        payment_status: "unpaid" as const,
        payment_provider: paymentMethod,
        front_mockup_url: frontUrl,
        back_mockup_url: backUrl,
        transparent_image_url: transparentUrl,
        prompt: prompt || null,
        size: size || null,
        cart_id: cartId,
        design_state: finalDesignState,
      };
      const rows = Array.from({ length: qty }, (_, i) => ({
        id: i === 0 ? orderId : crypto.randomUUID(),
        ...rowTemplate,
      }));

      // Delivery is charged ONCE on the first row so the sum across rows
      // equals totalWithDelivery. Same pattern as CartPage.tsx:215-218.
      rows[0].delivery_price = deliveryPrice;
      rows[0].total_price = rows[0].product_price + deliveryPrice;

      const redirectUrl = await submitOrder({
        rows,
        paymentOrderId: rows[0].id,
        amount: totalWithDelivery,
        description: `${product} - ${subProduct} (${color})`,
        paymentMethod,
        cartId: cartId ?? undefined,
        backTransparentBackfill: backTransparentUrl
          ? [{ orderIds: rows.map((r) => r.id), url: backTransparentUrl }]
          : undefined,
      });

      localStorage.setItem("maika_pending_order_id", rows[0].id);
      window.location.href = redirectUrl;
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className="w-full h-12 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base">
            <ShoppingBag className="h-5 w-5" />
            შეკვეთა
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">შეკვეთის ფორმა</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">სახელი *</Label>
              <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} required maxLength={100} placeholder="სახელი" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">გვარი *</Label>
              <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} required maxLength={100} placeholder="გვარი" />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">ელფოსტა *</Label>
            <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255} placeholder="email@example.com" />
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <Label htmlFor="phone">ტელეფონი *</Label>
            <Input id="phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} required maxLength={20} placeholder="+995 5XX XXX XXX" />
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <Label htmlFor="comment">კომენტარი</Label>
            <Textarea id="comment" value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} placeholder="დამატებითი ინფორმაცია..." rows={2} />
          </div>


          {/* Delivery options */}
          <div className="space-y-2">
            <Label>მიწოდება *</Label>
            <RadioGroup value={delivery} onValueChange={(v) => setDelivery(v as DeliveryType)} className="space-y-2">
              {(Object.keys(DELIVERY_LABELS) as DeliveryType[]).map((key) => (
                <div key={key} className="flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors">
                  <RadioGroupItem value={key} id={key} />
                  <Label htmlFor={key} className="cursor-pointer flex-1 text-sm font-normal">
                    {DELIVERY_LABELS[key]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Address - shown for courier options */}
          {delivery !== "pickup" && (
            <div className="space-y-1.5">
              <Label htmlFor="address">მისამართი *</Label>
              <Input id="address" value={address} onChange={e => setAddress(e.target.value)} required maxLength={500} placeholder="მიწოდების მისამართი" />
            </div>
          )}

          {/* Payment method */}
          <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />

          {/* Price summary */}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
            <h4 className="text-sm font-semibold text-card-foreground mb-2">შეკვეთის ჯამი</h4>
            <div className="space-y-1 text-sm">
              {qty > 1 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>რაოდენობა</span>
                  <span>{qty}</span>
                </div>
              )}
              <div className="flex justify-between text-muted-foreground">
                <span>პროდუქტის ფასი</span>
                <span>
                  {qty > 1
                    ? `${breakdown.total} ₾ × ${qty} = ${productSubtotal} ₾`
                    : `${breakdown.total} ₾`}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>მიწოდება</span>
                <span>{deliveryPrice === 0 ? "უფასო" : `${deliveryPrice} ₾`}</span>
              </div>
              <div className="border-t border-border pt-1.5 mt-1.5 flex justify-between font-bold text-base text-card-foreground">
                <span>სულ</span>
                <span className="text-primary">{totalWithDelivery} ₾</span>
              </div>
            </div>
          </div>

          <Button type="submit" disabled={submitting} className="w-full h-12 font-semibold text-base">
            {submitting ? "იგზავნება..." : "გადახდა და შეკვეთა"}
          </Button>
          <p className="text-xs text-muted-foreground text-center mt-2">
            წარმოების ვადა: 1-3 სამუშაო დღე
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
