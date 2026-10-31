// The bank-transfer receipt of a DM order, in the AdminOrders order detail
// (add-only, 2026-11-01). Reads social_order_drafts.receipt by cart_id and
// signs the receipt image from the PRIVATE social-uploads bucket — both
// admin-only through RLS / the bucket's admin SELECT policy. Display only:
// the operator still marks the order paid with the existing control.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { SOCIAL_UPLOAD_BUCKET } from "@/lib/socialInbox";
import { parseReceiptView, verdictTone, type ReceiptView } from "@/lib/receiptView";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export default function OrderReceipt({ cartId }: { cartId: string }) {
  const [view, setView] = useState<ReceiptView | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const { data, error } = await supabase
          .from("social_order_drafts")
          .select("receipt")
          .eq("cart_id", cartId)
          .maybeSingle();
        if (cancelled) return;
        const v = error || !data ? null : parseReceiptView((data as { receipt: unknown }).receipt);
        setView(v);
        if (v?.path) {
          const signed = await supabase.storage.from(SOCIAL_UPLOAD_BUCKET).createSignedUrl(v.path, SIGNED_URL_TTL_SECONDS);
          if (!cancelled) setImageUrl(signed.data?.signedUrl ?? null);
        }
      } catch (e) {
        console.warn("[OrderReceipt] receipt read failed:", e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cartId]);

  if (!loaded) return null;
  if (!view) {
    return <div className="text-xs text-muted-foreground">ქვითარი: ჯერ არ მიუღია</div>;
  }
  const tone = verdictTone(view.verdict);
  const cur = view.currency && view.currency.toUpperCase() !== "GEL" ? ` ${view.currency}` : " ₾";
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">ქვითარი (ბოტმა წაიკითხა)</h4>
      <div className="flex gap-3 items-start flex-wrap bg-background rounded-lg p-3 border border-border max-w-xl">
        {imageUrl ? (
          <a href={imageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <img src={imageUrl} alt="ქვითარი" className="h-40 w-auto max-w-[10rem] object-contain rounded border border-border" />
          </a>
        ) : (
          <div className="h-40 w-28 shrink-0 rounded border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground text-center p-1">
            {view.path ? "სურათი იტვირთება…" : "სურათი არ შეინახა"}
          </div>
        )}
        <div className="text-sm space-y-1 min-w-[12rem]">
          <Badge variant={tone === "ok" ? "default" : tone === "bad" ? "destructive" : "secondary"} className="text-[10px]">
            {view.verdictLabel}
          </Badge>
          <div>
            <span className="text-muted-foreground">თანხა: </span>
            {view.amount === null ? "—" : `${money(view.amount)}${cur}`} {view.amountOk ? "✓" : "✗"}
            {view.expectedTotal !== null && <span className="text-muted-foreground"> (შეკვეთა {money(view.expectedTotal)} ₾)</span>}
          </div>
          <div>
            <span className="text-muted-foreground">IBAN: </span>
            {view.ibanOk === null ? "—" : view.ibanOk ? "✓" : "✗"}
            {view.iban && <span className="font-mono text-xs"> {view.iban}</span>}
          </div>
          {view.recipientName && (
            <div><span className="text-muted-foreground">მიმღები: </span>{view.recipientName}</div>
          )}
          {view.date && (
            <div><span className="text-muted-foreground">თარიღი: </span>{view.date}</div>
          )}
          {view.earlier > 0 && (
            <div className="text-xs text-muted-foreground">ადრე გამოგზავნილი ქვითრები: {view.earlier}</div>
          )}
          <div className="text-xs text-muted-foreground">გადახდილად მონიშვნა — ქვემოთ, „გადახდა"</div>
        </div>
      </div>
    </div>
  );
}
