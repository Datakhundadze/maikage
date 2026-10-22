import { CATALOG_PROMO, catalogPromoRegularPrice, isCatalogPromoActive } from "@/lib/catalogPromo";

// /designs SALE strip — shown above both catalog views (rail and grid).
// Prices come from lib/catalogPromo.ts (promo) and pricing.ts PRICES (regular);
// nothing is typed here. Renders nothing once the promo ends or if the regular
// price is missing / not above the promo price.
export default function CatalogSaleBanner() {
  const regular = catalogPromoRegularPrice();
  if (!isCatalogPromoActive() || regular === undefined || regular <= CATALOG_PROMO.price) return null;

  const text = `ყველა დიზაინი ${CATALOG_PROMO.subProduct} მაისურზე — ${CATALOG_PROMO.price}₾ (ნაცვლად ${regular}₾)`;

  return (
    <div
      role="note"
      aria-label={`${CATALOG_PROMO.label} · ${text}`}
      className="shrink-0 border-b border-primary/40 bg-primary px-4 py-2 text-primary-foreground"
    >
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 text-center text-sm font-semibold leading-snug">
        <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold tracking-wide text-destructive-foreground">
          {CATALOG_PROMO.label}
        </span>
        <span>{text}</span>
      </p>
    </div>
  );
}
