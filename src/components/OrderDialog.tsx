import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ShoppingBag } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

import type { PriceBreakdown } from "@/lib/pricing";
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
  onBeforeOpen?: () => void;
  size?: string;
}

async function uploadMockupImage(dataUrl: string, orderId: string, side: string): Promise<string | null> {
  try {
    if (!dataUrl) {
      console.warn(`[OrderDialog] No ${side} mockup data URL provided`);
      return null;
    }
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    console.log(`[OrderDialog] Uploading ${side} mockup: ${blob.size} bytes`);
    const path = `order-mockups/${orderId}-${side}.png`;
    const { error } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png", upsert: true });
    if (error) {
      console.error(`[OrderDialog] Upload ${side} mockup failed:`, error);
      return null;
    }
    const { data } = supabase.storage.from("designs").getPublicUrl(path);
    console.log(`[OrderDialog] ${side} mockup uploaded:`, data.publicUrl);
    return data.publicUrl;
  } catch (e) {
    console.error(`[OrderDialog] Upload ${side} mockup error:`, e);
    return null;
  }
}

// Upload full-resolution originals so admin can download the user's raw photos
// (not the shrunken composite). Stored at a predictable path so admin can list them.
async function uploadOriginalPhotos(photos: string[], orderId: string, side: "front" | "back"): Promise<void> {
  await Promise.all(photos.map(async (dataUrl, i) => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
      const path = `order-originals/${orderId}/${side}-${i}.${ext}`;
      const { error } = await supabase.storage.from("designs").upload(path, blob, { contentType: blob.type, upsert: true });
      if (error) console.error(`[OrderDialog] Upload original ${side}-${i} failed:`, error);
    } catch (e) {
      console.error(`[OrderDialog] Upload original ${side}-${i} error:`, e);
    }
  }));
}

export default function OrderDialog({ breakdown, product, subProduct, color, isStudio, children, externalOpen, onExternalOpenChange, frontMockupDataUrl, backMockupDataUrl, transparentImageDataUrl, backTransparentImageDataUrl, frontOriginalPhotos, backOriginalPhotos, prompt, onBeforeOpen, size }: OrderDialogProps) {
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

  const deliveryPrice = DELIVERY_PRICES[delivery];
  const totalWithDelivery = breakdown.total + deliveryPrice;

  const canSubmit = firstName.trim() && lastName.trim() && email.trim() && phone.trim() &&
    (delivery === "pickup" || address.trim());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      const orderId = crypto.randomUUID();

      // Upload mockup images and full-resolution originals in parallel
      const [frontUrl, backUrl, transparentUrl, backTransparentUrl] = await Promise.all([
        frontMockupDataUrl ? uploadMockupImage(frontMockupDataUrl, orderId, "front") : Promise.resolve(null),
        backMockupDataUrl ? uploadMockupImage(backMockupDataUrl, orderId, "back") : Promise.resolve(null),
        transparentImageDataUrl ? uploadMockupImage(transparentImageDataUrl, orderId, "transparent") : Promise.resolve(null),
        backTransparentImageDataUrl ? uploadMockupImage(backTransparentImageDataUrl, orderId, "transparent-back") : Promise.resolve(null),
        frontOriginalPhotos?.length ? uploadOriginalPhotos(frontOriginalPhotos, orderId, "front") : Promise.resolve(),
        backOriginalPhotos?.length ? uploadOriginalPhotos(backOriginalPhotos, orderId, "back") : Promise.resolve(),
      ]);

      // 1. Insert order into database
      const { data: orderData, error } = await supabase.from("orders").insert({
        id: orderId,
        user_id: user?.id || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
        comment: comment.trim() || null,
        phone: phone.trim(),
        delivery_type: delivery,
        delivery_address: delivery !== "pickup" ? address.trim() : null,
        delivery_price: deliveryPrice,
        product_price: breakdown.total,
        total_price: totalWithDelivery,
        product,
        sub_product: subProduct,
        color,
        is_studio: isStudio,
        payment_status: "unpaid",
        payment_provider: paymentMethod,
        front_mockup_url: frontUrl,
        back_mockup_url: backUrl,
        transparent_image_url: transparentUrl,
        prompt: prompt || null,
        size: size || null,
      } as any).select("id").single();

      if (error) throw error;

      // Best-effort: populate back_transparent_image_url if the column exists in the
      // schema. If the migration hasn't been applied yet, silently ignore — the core
      // order data is already saved.
      if (backTransparentUrl) {
        const { error: backErr } = await supabase
          .from("orders")
          .update({ back_transparent_image_url: backTransparentUrl } as any)
          .eq("id", orderData.id);
        if (backErr) console.warn("[OrderDialog] back_transparent_image_url update skipped:", backErr.message);
      }

      // 2. Call create-payment edge function (route to TBC or BOG)
      const payFn = paymentMethod === "bog" ? "create-payment" : "create-payment-tbc";
      const paymentRes = await supabase.functions.invoke(payFn, {
        body: {
          orderId: orderData.id,
          amount: totalWithDelivery,
          description: `${product} - ${subProduct} (${color})`,
        },
      });

      if (paymentRes.error) {
        let detail = paymentRes.error.message || "Payment creation failed";
        const ctx = (paymentRes.error as any).context;
        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            if (body?.error) detail = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
          } catch {
            try {
              const text = await ctx.text();
              if (text) detail = text;
            } catch {}
          }
        }
        throw new Error(detail);
      }

      const { redirect_url } = paymentRes.data as { redirect_url: string };

      if (redirect_url) {
        localStorage.setItem("maika_pending_order_id", orderData.id);
        window.location.href = redirect_url;
      } else {
        throw new Error("No redirect URL received from payment provider");
      }
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
              <div className="flex justify-between text-muted-foreground">
                <span>პროდუქტის ფასი</span>
                <span>{breakdown.total} ₾</span>
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

          <Button type="submit" disabled={!canSubmit || submitting} className="w-full h-12 font-semibold text-base">
            {submitting ? "იგზავნება..." : "გადახდა და შეკვეთა"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
