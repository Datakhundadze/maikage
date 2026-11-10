// What a showroom rack card shows: the rack's photo and the garment's name.
// Kept out of the component so the walk can fetch the photo while it is
// still walking (the card then opens with it already there).

import { BRAND_SLUGS, LANDING_PRODUCT_SLUGS, resolveProductSlug } from "@/lib/productSlugs";
import { productTypeKa } from "@/lib/i18n";
import type { RackItem, ShowroomRack } from "./showroomRacks";

/** Width (px) of the rack card on wide screens (a panel on the right; ≥ 768 px). */
export const RACK_CARD_WIDE_PX = 340;
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

/**
 * David's own close-up photo of the rack (2026-11-05), 1200×1500 (4:5),
 * served with the site (public/tour/racks). The card shows it, the loupe
 * magnifies it.
 */
export function rackPhoto(rack: ShowroomRack): string {
  return `/tour/racks/${rack.id}.webp`;
}

/** Start downloading the rack's photo (fire and forget) — called when the walk there starts. */
export function preloadRack(rack: ShowroomRack): void {
  if (typeof Image === "undefined") return;
  new Image().src = rackPhoto(rack);
}

/**
 * Where "choose" on a rack card leads: the product's own landing route
 * (/t-shirt/giordano …) — the constructor with that product and brand already
 * picked. Not "/": a fresh tab at the root shows the home page, not the
 * constructor (David 2026-11-10: "it went to the main page"). The hash tells
 * the page the visitor came from the showroom (ShowroomBackdrop); a hash never
 * reaches the server or the canonical URL.
 */
export function rackLandingPath(rackId: string, it: RackItem): string {
  const productSlug = LANDING_PRODUCT_SLUGS.find((slug) => resolveProductSlug(slug) === it.product);
  if (!productSlug) return "/";
  const brands = BRAND_SLUGS[it.product] ?? {};
  const brandSlug = Object.keys(brands).find((slug) => brands[slug] === it.brand);
  return `/${productSlug}${brandSlug ? `/${brandSlug}` : ""}#showroom=${rackId}`;
}

/** The rack id a showroom hand-over left in the URL hash, or null. */
export function showroomRackFromHash(hash: string): string | null {
  const m = /^#showroom=([a-z0-9-]{1,40})$/.exec(hash);
  return m ? m[1] : null;
}
