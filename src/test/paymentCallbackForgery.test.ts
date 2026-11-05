import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// payment-callback is public (verify_jwt = false) and BOG callbacks are not
// signed there. The paid/failed outcome must come ONLY from BOG's API, looked
// up with the bog_order_id stored in OUR row (2026-11-05 forgery fix).
const SRC = readFileSync("supabase/functions/payment-callback/index.ts", "utf8");

describe("payment-callback cannot be forged", () => {
  it("final status comes from the BOG API only", () => {
    expect(SRC).toMatch(/const finalStatus = \(fresh\.status \|\| ""\)\.toLowerCase\(\);/);
    expect(SRC).not.toMatch(/let finalStatus = callbackStatus/);
    expect(SRC).not.toMatch(/finalStatus = fresh\.status \|\| finalStatus/);
  });
  it("lookup uses the stored bog_order_id, never a body-supplied id", () => {
    expect(SRC).toMatch(/fetchBogStatus\(storedBogId\)/);
    expect(SRC).not.toMatch(/bogOrderIdForLookup/);
  });
  it("ignores non-BOG orders, missing ids and an unavailable API without changing anything", () => {
    expect(SRC).toMatch(/if \(provider !== "bog"\) return ignore\(/);
    expect(SRC).toMatch(/if \(!storedBogId\) return ignore\(/);
    expect(SRC).toMatch(/if \(!fresh\) return ignore\(/);
    const firstIgnore = SRC.indexOf("return ignore(");
    const firstUpdate = SRC.indexOf("applyUpdate({");
    expect(firstIgnore).toBeGreaterThan(0);
    expect(firstUpdate).toBeGreaterThan(firstIgnore);
  });
});
