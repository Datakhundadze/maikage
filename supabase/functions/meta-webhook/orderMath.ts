// Order totals for a DM order, computed in code — never from the model's text.
// Same rules as the site checkout (OrderDialog.tsx / CartPage.tsx):
//   item price = calculatePrice(...).total (pricingCopy.ts, an exact copy)
//   delivery   = DELIVERY_PRICES[type], charged once (on the first row)
//   bag fee    = BAG_FEE (src/lib/fees.ts), once per order (on the first row)
// src/test/socialOrder.test.ts checks these constants against the site files.

import { calculatePrice, type BackPrintSize } from "./pricingCopy.ts";

export type DeliveryType = "pickup" | "courier_tbilisi" | "courier_outside";

export const DELIVERY_PRICES: Record<DeliveryType, number> = {
  pickup: 0,
  courier_tbilisi: 8,
  courier_outside: 12,
};

export const BAG_FEE = 1;

export interface OrderItemInput {
  product: string;
  subProduct: string;
  hasFront: boolean;
  hasBack: boolean;
  /** AI-generated design (the site's +5 "studio" surcharge) — owner decides if it applies. */
  isStudio: boolean;
  backSize?: BackPrintSize;
  quantity: number;
}

export interface OrderTotals {
  unitPrices: number[];
  lineTotals: number[];
  subtotal: number;
  delivery: number;
  bagFee: number;
  total: number;
}

export function orderTotals(items: OrderItemInput[], delivery: DeliveryType): OrderTotals {
  const unitPrices = items.map((i) =>
    calculatePrice(i.product, i.subProduct, i.hasFront, i.hasBack, i.isStudio, i.backSize ?? "big").total);
  const lineTotals = unitPrices.map((p, k) => p * Math.max(1, Math.floor(items[k].quantity || 1)));
  const subtotal = lineTotals.reduce((a, b) => a + b, 0);
  const deliveryPrice = DELIVERY_PRICES[delivery];
  return { unitPrices, lineTotals, subtotal, delivery: deliveryPrice, bagFee: BAG_FEE, total: subtotal + deliveryPrice + BAG_FEE };
}
