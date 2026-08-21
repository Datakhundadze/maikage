// The order-status card under an assistant bubble, shared by /chat and the
// floating ChatWidget.
//
// ⚠️ THE ORDER DATA LIVES ONLY IN THIS COMPONENT'S STATE. It is never written
// into a message's `content`, which is what both chats replay to the model as
// history, and it is never persisted — chatPersistence stores `content` and the
// (payload-free) suggestion, nothing from here. So the model cannot see an
// order on this turn or on any later one.
//
// Nothing is fetched until the customer is signed in. A guest gets an invite to
// sign in, not a lookup, because the query is authorised by auth.uid() and an
// anonymous caller matches no policy on `orders`.
import { useEffect, useState } from "react";
import { LogIn, Package, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import type { Lang } from "@/lib/i18n";
import {
  coarseDate,
  fetchOwnOrderStatus,
  paymentLabel,
  statusLabel,
  type OrderStatusResult,
} from "@/lib/orderStatus";

export default function ChatOrderStatus({
  lang,
  compact = false,
  onSignIn,
}: {
  lang: Lang;
  /** The widget's tighter sizing. Purely dimensional. */
  compact?: boolean;
  /** Open the login modal. The card never navigates on its own. */
  onSignIn: () => void;
}) {
  const { user, isAnonymous } = useAuth();
  // An anonymous session is `authenticated` to Postgres but owns no orders, so
  // it is treated as a guest here rather than being sent to an empty lookup.
  const isLoggedIn = !!user && !isAnonymous;
  const [result, setResult] = useState<OrderStatusResult | null>(null);

  useEffect(() => {
    if (!isLoggedIn) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult(null);
    fetchOwnOrderStatus().then((r) => {
      if (!cancelled) setResult(r);
    });
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const en = lang === "en";
  const btnCls = `mt-2 w-full font-semibold bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 ${
    compact ? "h-9 gap-1.5 text-xs" : "h-10 gap-2"
  }`;
  const iconCls = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  if (!isLoggedIn) {
    return (
      <Button onClick={onSignIn} size={compact ? "sm" : "default"} className={btnCls}>
        <LogIn className={iconCls} />
        {en ? "Sign in to see your order" : "შესვლა შეკვეთის სანახავად"}
      </Button>
    );
  }

  if (result === null) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {en ? "Checking…" : "ვამოწმებ..."}
      </div>
    );
  }

  if (result.kind === "error") {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {en
          ? "Couldn't check right now. Please try again in a moment."
          : "ვერ შევამოწმე. სცადეთ ცოტა ხანში."}
      </div>
    );
  }

  if (result.kind === "none") {
    return (
      <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {en
          ? "No orders found on this account. If you ordered as a guest, it won't appear here — contact us and we'll check."
          : "ამ ანგარიშზე შეკვეთა ვერ ვიპოვე. თუ სტუმრად შეუკვეთეთ, აქ არ გამოჩნდება — დაგვიკავშირდით და შევამოწმებთ."}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1.5">
      {result.groups.map((g) => (
        <div key={g.key} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Package className="h-3 w-3" />
            {en ? "Order placed" : "შეკვეთა გაფორმდა"} · {coarseDate(g.createdAt, lang)}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
              {statusLabel(g.status, lang)}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
              {paymentLabel(g.paymentStatus, lang)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
