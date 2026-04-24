import { useEffect, useState } from "react";
import { useCart, type CartItem } from "@/hooks/useCart";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import AppHeader from "@/components/AppHeader";
import PaymentMethodSelector, { type PaymentMethod } from "@/components/PaymentMethodSelector";
import { ArrowLeft, Minus, Plus, Trash2, ShoppingBag } from "lucide-react";

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

function CartItemRow({
  item,
  onRemove,
  onQtyChange,
}: {
  item: CartItem;
  onRemove: () => void;
  onQtyChange: (q: number) => void;
}) {
  return (
    <div className="flex gap-3 p-3 rounded-lg border border-border bg-card">
      <div className="w-20 h-20 rounded border border-border bg-muted overflow-hidden flex-shrink-0">
        {item.frontMockupUrl ? (
          <img src={item.frontMockupUrl} alt="" className="w-full h-full object-contain" />
        ) : null}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {item.product}
          {item.subProduct ? ` • ${item.subProduct}` : ""}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.color}
          {item.size ? ` • ${item.size}` : ""}
          {item.isStudio ? " • AI Studio" : ""}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => onQtyChange(item.quantity - 1)}
            disabled={item.quantity <= 1}
            className="h-7 w-7 rounded border border-border flex items-center justify-center disabled:opacity-40 hover:bg-accent"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="text-sm font-semibold w-6 text-center">{item.quantity}</span>
          <button
            onClick={() => onQtyChange(item.quantity + 1)}
            className="h-7 w-7 rounded border border-border flex items-center justify-center hover:bg-accent"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={onRemove}
            className="ml-auto h-7 w-7 rounded border border-border flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground"
            title="წაშლა"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold">{item.productPrice * item.quantity} ₾</div>
        {item.quantity > 1 && (
          <div className="text-[10px] text-muted-foreground">{item.productPrice} ₾ × {item.quantity}</div>
        )}
      </div>
    </div>
  );
}

export default function CartPage() {
  const { items, removeItem, updateQuantity, clearCart, totalPrice } = useCart();
  const { setMode } = useAppState();
  const { user } = useAuth();
  const { toast } = useToast();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [comment, setComment] = useState("");
  const [delivery, setDelivery] = useState<DeliveryType>("pickup");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bog");

  const deliveryPrice = DELIVERY_PRICES[delivery];
  const totalWithDelivery = totalPrice + deliveryPrice;

  const canSubmit =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    phone.trim() &&
    (delivery === "pickup" || address.trim());

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || items.length === 0) return;
    setSubmitting(true);

    try {
      const cartId = crypto.randomUUID();
      // Expand items by quantity → one order row per unit
      const rows = items.flatMap((item) => {
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
          product_price: item.productPrice,
          total_price: item.productPrice,
          product: item.product,
          sub_product: item.subProduct,
          color: item.color,
          is_studio: item.isStudio,
          payment_status: "unpaid" as const,
          payment_provider: paymentMethod,
          front_mockup_url: item.frontMockupUrl,
          back_mockup_url: item.backMockupUrl,
          transparent_image_url: item.transparentImageUrl,
          prompt: item.prompt,
          size: item.size,
          cart_id: cartId,
        };
        return Array.from({ length: item.quantity }, () => ({
          id: crypto.randomUUID(),
          ...rowTemplate,
        }));
      });

      // Charge delivery to the first order row so the sum matches totalWithDelivery
      if (rows.length > 0) {
        rows[0].delivery_price = deliveryPrice;
        rows[0].total_price = rows[0].product_price + deliveryPrice;
      }

      const { error } = await supabase.from("orders").insert(rows as any);
      if (error) throw error;

      // Best-effort: populate back_transparent_image_url for rows that have it.
      // If the column hasn't been added via migration yet, silently skip.
      for (const item of items) {
        if (item.backTransparentImageUrl) {
          const matchingIds = rows
            .filter(r => r.front_mockup_url === item.frontMockupUrl)
            .map(r => r.id);
          await supabase
            .from("orders")
            .update({ back_transparent_image_url: item.backTransparentImageUrl } as any)
            .in("id", matchingIds)
            .then(({ error: e }) => { if (e) console.warn("[Cart] back_transparent_image_url skipped:", e.message); });
        }
      }

      const firstOrderId = rows[0].id;
      const description =
        items.length === 1
          ? `${items[0].product} - ${items[0].subProduct || ""} (${items[0].color})`
          : `Cart: ${rows.length} items`;

      const payFn = paymentMethod === "bog" ? "create-payment" : "create-payment-tbc";
      const paymentRes = await supabase.functions.invoke(payFn, {
        body: {
          orderId: firstOrderId,
          amount: totalWithDelivery,
          description,
          cartId,
        },
      });

      if (paymentRes.error) {
        const detail = paymentRes.data?.error || paymentRes.error.message || "Payment creation failed";
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }

      const { redirect_url } = paymentRes.data as { redirect_url: string };
      if (!redirect_url) throw new Error("No redirect URL received from payment provider");

      localStorage.setItem("maika_pending_order_id", firstOrderId);
      localStorage.setItem("maika_pending_cart_id", cartId);
      clearCart();
      window.location.href = redirect_url;
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
      setSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col h-screen">
        <AppHeader />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <ShoppingBag className="h-16 w-16 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">კალათა ცარიელია</h2>
          <p className="text-sm text-muted-foreground mb-6">
            დაამატე პროდუქტები, რომ გააგრძელო შეკვეთა
          </p>
          <Button onClick={() => setMode("landing")}>მთავარზე დაბრუნება</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <AppHeader />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMode("landing")}
              className="h-8 w-8 rounded border border-border flex items-center justify-center hover:bg-accent"
              title="უკან"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="text-xl font-bold">კალათა ({items.length})</h1>
          </div>

          <div className="space-y-2">
            {items.map((item) => (
              <CartItemRow
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onQtyChange={(q) => updateQuantity(item.id, q)}
              />
            ))}
          </div>

          {!showCheckout ? (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">პროდუქტები</span>
                <span className="font-semibold">{totalPrice} ₾</span>
              </div>
              <div className="flex justify-between text-base font-bold border-t border-border pt-2">
                <span>სულ</span>
                <span className="text-primary">{totalPrice} ₾ + მიწოდება</span>
              </div>
              <Button
                onClick={() => setShowCheckout(true)}
                className="w-full h-12 font-semibold text-base"
              >
                გადახდაზე გადასვლა
              </Button>
            </div>
          ) : (
            <form onSubmit={handleCheckout} className="space-y-4 rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold">მიწოდების ინფორმაცია</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">სახელი *</Label>
                  <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">გვარი *</Label>
                  <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">ელფოსტა *</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">ტელეფონი *</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={20} placeholder="+995 5XX XXX XXX" />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="comment">კომენტარი</Label>
                <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} />
              </div>

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

              {delivery !== "pickup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="address">მისამართი *</Label>
                  <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} required maxLength={500} />
                </div>
              )}

              <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />

              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-1.5">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>პროდუქტები</span>
                  <span>{totalPrice} ₾</span>
                </div>
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>მიწოდება</span>
                  <span>{deliveryPrice === 0 ? "უფასო" : `${deliveryPrice} ₾`}</span>
                </div>
                <div className="border-t border-border pt-1.5 mt-1.5 flex justify-between font-bold text-base">
                  <span>სულ</span>
                  <span className="text-primary">{totalWithDelivery} ₾</span>
                </div>
              </div>

              <Button type="submit" disabled={!canSubmit || submitting} className="w-full h-12 font-semibold text-base">
                {submitting ? "იგზავნება..." : "გადახდა და შეკვეთა"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
