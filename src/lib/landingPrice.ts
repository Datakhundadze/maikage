// "From" price for the product landing hero (/hoodie, /hoodie/premium-washed, …).
//
// A CALL into calculatePrice, never a copy of its table: a design with nothing
// on either side and no Studio surcharge is exactly what the constructor's own
// price card shows before anything is added (SimplePage → PriceDisplay), and it
// is the lowest total that product + brand can have — the back side and the AI
// surcharge only ever add. So the hero and the price card can never disagree.
import { calculatePrice } from "@/lib/pricing";
import type { ProductType } from "@/lib/catalog";
import { defaultBrandFor } from "@/lib/productSlugs";

export function fromPrice(product: ProductType, brand: string | null): number {
  return calculatePrice(product, brand ?? defaultBrandFor(product), false, false, false).total;
}
