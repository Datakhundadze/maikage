import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Smoke test: AdminSpend renders sums from a stubbed Supabase client and does
// not crash when the admin_ai_spend RPC errors.
import { render, screen, waitFor } from "@testing-library/react";

const data: Record<string, unknown> = {
  ai_model_prices: [{ model: "gemini-flash", cost_usd_per_call: "0.0390", note: null, updated_at: null }],
  marketing_spend: [{ id: "m1", date: "2026-10-05", channel: "meta", campaign: "C1", adset: "A", amount_usd: "30.00", results: 6, result_type: "მესიჯი", note: null, created_at: "x" }],
  fixed_costs: [
    { id: "f1", name: "Lovable", amount: "25", currency: "USD", period: "monthly", start_on: null, end_on: null, paid_on: null, active: true, note: null, created_at: "x" },
    { id: "f2", name: "Domain", amount: "54", currency: "GEL", period: "yearly", start_on: null, end_on: null, paid_on: null, active: true, note: null, created_at: "x" },
  ],
  spend_settings: { usd_gel: "2.7000" },
};
function chain(table: string) {
  const res = { data: data[table], error: null };
  const c: Record<string, unknown> = {};
  for (const k of ["select", "order", "gte", "lt", "eq", "update", "insert", "upsert", "delete"]) c[k] = () => c;
  c.maybeSingle = () => Promise.resolve(res);
  c.then = (f: (v: unknown) => unknown) => Promise.resolve(res).then(f);
  return c;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => chain(t),
    rpc: () => Promise.resolve({ data: (globalThis as Record<string, unknown>).__rpc ?? [
      { day: "2026-10-18", action: "generate-design", model: "gemini-flash", calls_ok: "10", calls_failed: "1", calls_failed_maybe_billed: "1", unit_cost: "0.039", cost: "0.39", cost_max: "0.429" },
      { day: "2026-10-17", action: "upscale", model: "new-model", calls_ok: 2, calls_failed: 0, calls_failed_maybe_billed: 0, unit_cost: null, cost: null, cost_max: null },
    ], error: (globalThis as Record<string, unknown>).__rpcErr ?? null }),
  },
}));
import AdminSpend from "@/components/admin/AdminSpend";

describe("AdminSpend render", () => {
  afterEach(() => { cleanup(); delete (globalThis as Record<string, unknown>).__rpcErr; });
  it("renders with data", async () => {
    render(<AdminSpend />);
    await waitFor(() => expect(screen.getByText("დიზაინის გენერაცია")).toBeTruthy());
    const t = document.body.textContent!;
    expect(t).toContain("$30.00 · 81.00 ₾"); // ads, rate 2.70
    expect(t).toContain("$26.67 · 72.00 ₾"); // 25 USD monthly + 54 GEL yearly / 12 / 2.70
    expect(t).toContain("ფასი უცნობია");
    expect(t).toContain("new-model");
  });
  it("survives RPC error", async () => {
    (globalThis as Record<string, unknown>).__rpcErr = { message: "permission denied" };
    render(<AdminSpend />);
    await waitFor(() => expect(screen.getByText(/permission denied/)).toBeTruthy());
  });
});
