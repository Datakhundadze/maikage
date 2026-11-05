import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRICES } from "@/lib/pricing";
import { CATALOG_PROMO } from "@/lib/catalogPromo";

// The DB price floor (migration 20261105170000_orders_price_floor.sql) rejects
// browser orders priced below floor(0.75 × lowest legit price). If PRICES gains
// a key or a price drops far enough to hit its floor, this fails: update the
// price_floors table on prod (admins can edit it) and the migration.
const SQL = readFileSync("supabase/migrations/20261105170000_orders_price_floor.sql", "utf8");
const floors = new Map<string, number>();
for (const m of SQL.matchAll(/\('((?:[^']|'')+)',(\d+)\)/g)) floors.set(m[1].replace(/''/g, "'"), Number(m[2]));

describe("price_floors match src/lib/pricing.ts", () => {
  it("every PRICES key has a floor", () => {
    for (const key of Object.keys(PRICES)) expect(floors.has(key), key).toBe(true);
  });
  it("no legit price (incl. catalog SALE) is below its floor", () => {
    for (const [key, tier] of Object.entries(PRICES)) {
      const lowest = Math.min(tier.frontOnly, key === CATALOG_PROMO.subProduct ? CATALOG_PROMO.price : Infinity);
      expect(floors.get(key)!, key).toBeLessThanOrEqual(Math.floor(lowest * 0.75));
    }
  });
});
