import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(`supabase/functions/${f}/index.ts`, "utf8");

describe("create-payment* (2026-11-05 security batch)", () => {
  for (const fn of ["create-payment", "create-payment-flitt", "create-payment-tbc"]) {
    it(`${fn}: refuses already-paid orders and never resets a paid row`, () => {
      const s = read(fn);
      expect(s).toContain('JSON.stringify({ error: "Order already paid" })');
      expect(s).toContain("!rowsForGuard.some((r) => r.id === orderId)");
      expect((s.match(/\.neq\("payment_status", "paid"\)/g) ?? []).length).toBe(2);
    });
  }
  for (const fn of ["create-payment", "create-payment-flitt"]) {
    it(`${fn}: backfill only touches this order's rows and our own storage`, () => {
      const s = read(fn);
      expect(s).toContain('.in("id", scopedIds)');
      expect(s).not.toContain('.in("id", entry.orderIds)');
      expect(s).toContain("/storage/v1/object/public/designs/");
    });
  }
});

describe("gemini-proxy convert-bg-black", () => {
  it("has its own rate-limit bucket before the handler", () => {
    const s = read("gemini-proxy");
    const gate = s.indexOf("bgblack:ip:");
    const handler = s.indexOf('} else if (action === "convert-bg-black") {');
    expect(gate).toBeGreaterThan(0);
    expect(handler).toBeGreaterThan(gate);
  });
});

describe("generate-weekly-sales-report", () => {
  it("only runs for the service role", () => {
    expect(read("generate-weekly-sales-report")).toContain('if (jwtRole(req.headers.get("Authorization")) !== "service_role")');
  });
});
