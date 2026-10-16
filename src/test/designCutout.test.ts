import { describe, it, expect, vi } from "vitest";
import { keyDesignCutout, MIN_KEYED_FRACTION } from "@/lib/designCutout";

describe("keyDesignCutout", () => {
  it("keys the edit result directly when it has a green backdrop (no fallback call)", async () => {
    const key = vi.fn(async (img: string) => ({ image: `keyed:${img}`, keyedFraction: 0.4 }));
    const isolate = vi.fn(async (img: string) => `iso:${img}`);
    const r = await keyDesignCutout("edit", { key, isolate });
    expect(r).toEqual({ image: "keyed:edit", keyedFraction: 0.4, usedFallback: false });
    expect(isolate).not.toHaveBeenCalled();
  });

  it("falls back to isolate-design ON THE EDIT RESULT when nothing keyed (< 2%)", async () => {
    const key = vi.fn(async (img: string) => ({
      image: `keyed:${img}`,
      keyedFraction: img === "edit" ? 0 : 0.3,
    }));
    const isolate = vi.fn(async (img: string) => `iso:${img}`);
    const r = await keyDesignCutout("edit", { key, isolate });
    expect(isolate).toHaveBeenCalledTimes(1);
    expect(isolate).toHaveBeenCalledWith("edit");
    expect(r).toEqual({ image: "keyed:iso:edit", keyedFraction: 0.3, usedFallback: true });
  });

  it("returns null when the fallback also fails — the caller keeps the layer", async () => {
    const key = vi.fn(async () => ({ image: "unchanged", keyedFraction: MIN_KEYED_FRACTION / 2 }));
    const isolate = vi.fn(async () => "iso");
    const r = await keyDesignCutout("edit", { key, isolate });
    expect(r.image).toBeNull();
    expect(r.usedFallback).toBe(true);
    expect(isolate).toHaveBeenCalledTimes(1); // one fallback, never more
  });

  it("threshold is the photo path's 0.02", () => {
    expect(MIN_KEYED_FRACTION).toBe(0.02);
  });
});
