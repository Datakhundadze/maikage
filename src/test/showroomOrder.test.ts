import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { op: string; args: unknown[] }[] = [];
let insertError: { message: string } | null = null;

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => ({
    insert: (rows: unknown) => { calls.push({ op: `${table}.insert`, args: [rows] }); return Promise.resolve({ error: insertError }); },
    update: (v: unknown) => ({ in: (col: string, ids: unknown) => { calls.push({ op: `${table}.update`, args: [v, col, ids] }); return Promise.resolve({ error: null }); } }),
    upsert: (rows: unknown, opts: unknown) => { calls.push({ op: `${table}.upsert`, args: [rows, opts] }); return Promise.resolve({ error: null }); },
  });
  const rpc = (fn: string, args: unknown) => { calls.push({ op: `rpc.${fn}`, args: [args] }); return Promise.resolve({ error: null }); };
  return { supabase: { from, rpc } };
});

import { saveShowroomOrder } from "@/lib/showroomOrder";

const rows = [
  { id: "a", cart_id: "c", payment_provider: "tbc", payment_status: "unpaid" },
  { id: "b", cart_id: "c", payment_provider: "tbc", payment_status: "unpaid" },
];

describe("saveShowroomOrder", () => {
  beforeEach(() => { calls.length = 0; insertError = null; });

  it("inserts as unpaid showroom rows and never calls a payment function", async () => {
    await saveShowroomOrder({ rows, paid: false, adminUserId: "u" });
    const ins = calls.find((c) => c.op === "orders.insert")!.args[0] as Record<string, unknown>[];
    expect(ins.every((r) => r.payment_provider === "showroom" && r.payment_status === "unpaid")).toBe(true);
    expect(calls.some((c) => c.op.startsWith("rpc."))).toBe(false);
  });

  it("paid → admin_update_order per row (never inserts 'paid')", async () => {
    await saveShowroomOrder({ rows, paid: true, adminUserId: "u" });
    const ins = calls.find((c) => c.op === "orders.insert")!.args[0] as Record<string, unknown>[];
    expect(ins.every((r) => r.payment_status === "unpaid")).toBe(true);
    const rpcs = calls.filter((c) => c.op === "rpc.admin_update_order").map((c) => c.args[0]);
    expect(rpcs).toEqual([
      { p_order_id: "a", p_field: "payment_status", p_value: "paid" },
      { p_order_id: "b", p_field: "payment_status", p_value: "paid" },
    ]);
  });

  it("applies the back print backfill and tags the channel as store", async () => {
    await saveShowroomOrder({ rows, paid: false, adminUserId: "u", backTransparentBackfill: [{ orderIds: ["a"], url: "https://x/b.png" }] });
    expect(calls.find((c) => c.op === "orders.update")!.args).toEqual([{ back_transparent_image_url: "https://x/b.png" }, "id", ["a"]]);
    const up = calls.find((c) => c.op === "order_attribution.upsert")!.args[0] as Record<string, unknown>[];
    expect(up.map((r) => [r.order_id, r.manual_channel])).toEqual([["a", "store"], ["b", "store"]]);
  });

  it("insert failure throws and does nothing else", async () => {
    insertError = { message: "rls" };
    await expect(saveShowroomOrder({ rows, paid: true, adminUserId: "u" })).rejects.toThrow("rls");
    expect(calls.map((c) => c.op)).toEqual(["orders.insert"]);
  });
});
