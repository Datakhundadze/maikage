// What a showroom rack card shows for one garment: its name and picture.
// Kept out of the component so the walk can fetch the picture while it is
// still walking (the card then opens with it already there).

import { catalog, type ProductColor } from "@/lib/catalog";
import { productTypeKa } from "@/lib/i18n";
import type { RackItem, ShowroomRack } from "./showroomRacks";

/** Width (px) of the rack card on wide screens (a panel on the right; ≥ 768 px). */
export const RACK_CARD_WIDE_PX = 320;
/** Wide screens: the card is a side panel and the view turns so the rack sits left of it. */
export const RACK_CARD_WIDE_QUERY = "(min-width: 768px)";

const BRAND_LABEL: Record<string, string> = {
  "JEL T-Shirt": "JEL Washed",
  "GILDAN Hoodie": "GILDAN",
  "Premium Washed Hoodie": "Premium Washed",
  "JEL Zipper": "JEL Washed Zipper",
};

/** "GILDAN მაისური"; a product without brands (the tote bag: brand = product) is just its name. */
export function rackItemName(it: RackItem): string {
  if (it.brand === it.product) return productTypeKa(it.product);
  return `${BRAND_LABEL[it.brand] ?? it.brand} ${productTypeKa(it.product)}`;
}

/** The white (else first) colour's front photo, or null. */
export function rackItemImage(it: RackItem): string | null {
  const colors = catalog.getAvailableColors(it.product, it.brand);
  const color = (colors.includes("White" as ProductColor) ? "White" : colors[0]) as ProductColor | undefined;
  if (!color) return null;
  return catalog.findImageForColor(it.product, it.brand, color, "front")?.entry.imageUrl ?? null;
}

/** Start downloading the rack's pictures (fire and forget). */
export function preloadRack(rack: ShowroomRack): void {
  if (rack.items === "catalog" || typeof Image === "undefined") return;
  for (const it of rack.items) {
    const src = rackItemImage(it);
    if (src) new Image().src = src;
  }
}
