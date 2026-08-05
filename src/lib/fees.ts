// Order-level fees — charged ONCE per order, not per item.
//
// Deliberately NOT in pricing.ts: calculatePrice() is per-item and must stay
// byte-stable, and catalog/product-page prices must not change. These fees are
// added only at checkout, on top of the product subtotal and delivery.
//
// Storage (option A — no schema change): the fee is folded into the FIRST
// order row's total_price, mirroring how delivery is charged once on rows[0].
// product_price and delivery_price are left untouched, so the weekly
// accountant report (which sums product_price) and delivery revenue stay
// clean. Payment validation sums total_price across the rows and rejects a
// mismatch of >= 1 GEL, so the `amount` sent to the payment function MUST
// include this fee too — see OrderDialog.tsx / CartPage.tsx.

/** Branded paper bag, 1 GEL per order, all delivery types (incl. pickup). */
export const BAG_FEE = 1;

/** Breakdown label for the bag fee line. */
export const BAG_FEE_LABEL_KA = "ჩანთა";
