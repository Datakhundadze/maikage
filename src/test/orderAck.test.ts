import { describe, expect, it } from "vitest";
import { needsAck, ACK_STATUS } from "@/lib/orderAck";

const base = { status: "confirmed", payment_status: "paid", payment_provider: "tbc", created_at: "2026-11-19T17:52:52.975989+00:00" };

describe("needsAck — paid orders nobody has taken yet", () => {
  it("a paid, confirmed site order is pinned", () => expect(needsAck(base)).toBe(true));
  it("stops being pinned once taken", () => expect(needsAck({ ...base, status: ACK_STATUS })).toBe(false));
  it("unpaid and failed checkouts are never pinned", () => {
    expect(needsAck({ ...base, payment_status: "failed", status: "pending" })).toBe(false);
    expect(needsAck({ ...base, payment_status: "unpaid", status: "pending" })).toBe(false);
  });
  it("showroom orders (entered by staff) are not pinned", () =>
    expect(needsAck({ ...base, payment_provider: "showroom" })).toBe(false));
  it("orders before the cut-off are not pinned", () =>
    expect(needsAck({ ...base, created_at: "2026-11-18T12:00:00+00:00" })).toBe(false));
  it("later statuses are not pinned", () => {
    for (const status of ["shipped", "delivered", "cancelled"]) expect(needsAck({ ...base, status })).toBe(false);
  });
});
