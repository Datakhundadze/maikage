import { format } from "date-fns";
import { Package } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { shortOrderId, type CustomerOrder, type OrderGroup } from "@/lib/orderGrouping";

// Customer-facing card for one grouped order. Shared between the order
// confirmation page and the My Orders tab so both render identically.

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  in_production: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  shipped: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  cancelled: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const PAYMENT_BADGE: Record<string, string> = {
  unpaid: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  paid: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/15 text-red-600 dark:text-red-400",
  refunded: "bg-muted text-muted-foreground",
};

function statusLabel(lang: Lang, status: string): string {
  const key = `orders.status.${status}`;
  const label = t(lang, key);
  return label === key ? status : label;
}

function paymentLabel(lang: Lang, payment: string): string {
  const key = `orders.payment.${payment}`;
  const label = t(lang, key);
  return label === key ? payment : label;
}

function itemLabel(lang: Lang, row: CustomerOrder): string {
  const product = t(lang, `products.${row.product}`);
  const productName = product === `products.${row.product}` ? row.product : product;
  const parts = [productName];
  if (row.color) {
    const color = t(lang, `colors.${row.color}`);
    parts.push(color === `colors.${row.color}` ? row.color : color);
  }
  if (row.size) parts.push(row.size);
  return parts.join(" · ");
}

interface OrderCardProps {
  group: OrderGroup<CustomerOrder>;
  lang: Lang;
}

export default function OrderCard({ group, lang }: OrderCardProps) {
  const { head, rows, quantity, groupTotal } = group;
  const thumb = head.front_mockup_url || head.back_mockup_url;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex gap-3 p-3">
        {/* Thumbnail */}
        <div className="relative h-20 w-20 shrink-0 rounded-xl bg-muted overflow-hidden flex items-center justify-center">
          {thumb ? (
            <img src={thumb} alt={head.product} width={160} height={160} className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <Package className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        {/* Details */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-muted-foreground">
              {t(lang, "orders.orderNumber")} #{shortOrderId(head.id)}
            </span>
            <span className="text-xs text-muted-foreground">
              {format(new Date(head.created_at), "dd.MM.yyyy")}
            </span>
          </div>

          {/* Per-unit lines (a multi-item cart lists each row) */}
          <div className="text-sm font-medium text-foreground leading-snug">
            {rows.map((r) => (
              <div key={r.id} className="truncate">{itemLabel(lang, r)}</div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_BADGE[head.payment_status] ?? "bg-muted text-muted-foreground"}`}>
              {paymentLabel(lang, head.payment_status)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[head.status] ?? "bg-muted text-muted-foreground"}`}>
              {statusLabel(lang, head.status)}
            </span>
            {quantity > 1 && (
              <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-muted text-muted-foreground">
                {t(lang, "orders.quantity")}: {quantity}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-2 bg-muted/30">
        <span className="text-xs text-muted-foreground">{t(lang, "orders.total")}</span>
        <span className="text-sm font-bold text-foreground">{groupTotal} ₾</span>
      </div>
    </div>
  );
}
