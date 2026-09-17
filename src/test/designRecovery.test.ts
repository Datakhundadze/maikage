import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  __resetDesignRecoveryForTests,
  consumeDesignRecovery,
  discardDesignStash,
  registerDesignSnapshotProvider,
  stashDesignForRedirect,
  RECOVERY_TTL_MS,
  type DesignSnapshot,
} from "@/lib/designRecovery";

// jsdom has no IndexedDB, so every test here exercises the sessionStorage
// FALLBACK path (marker + payload + degradation). The IndexedDB path is
// verified in a real Chromium by the Playwright run recorded in the branch's
// summary.

const photo = (bytes: number, tag = "p") => ({
  id: `${tag}-${bytes}`,
  image: `data:image/png;base64,${"A".repeat(bytes)}`,
  coords: { x: 0.5, y: 0.5, scale: 1 },
});

function snapshot(over: Partial<DesignSnapshot> = {}): DesignSnapshot {
  return {
    front: { photos: [photo(1000, "f")], texts: [{ id: "t1", content: "hi" }] },
    back: { photos: [], texts: [] },
    aiResult: { resultImage: "r".repeat(500), transferImage: "t".repeat(500), downloadImage: "d".repeat(500) },
    ...over,
  };
}

beforeEach(() => {
  sessionStorage.clear();
  __resetDesignRecoveryForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("designRecovery (sessionStorage fallback)", () => {
  it("round-trips a design through stash → consume, exactly once, and clears itself", async () => {
    const snap = snapshot();
    registerDesignSnapshotProvider(() => snap);
    await stashDesignForRedirect();
    expect(sessionStorage.getItem("maika-design-recovery")).not.toBeNull();
    expect(sessionStorage.getItem("maika-design-recovery-payload")).not.toBeNull();

    const got = await consumeDesignRecovery();
    expect(got).not.toBeNull();
    expect(got!.snapshot).toEqual(snap);
    expect(got!.dropped).toEqual({ photos: 0, aiResult: false });
    expect(sessionStorage.getItem("maika-design-recovery")).toBeNull();
    expect(sessionStorage.getItem("maika-design-recovery-payload")).toBeNull();

    // Same page load: memoised, same answer. Next page load: nothing left.
    expect(await consumeDesignRecovery()).toBe(got);
    __resetDesignRecoveryForTests();
    expect(await consumeDesignRecovery()).toBeNull();
  });

  it("stashes nothing for an empty design or when no constructor is mounted", async () => {
    await stashDesignForRedirect();
    expect(sessionStorage.length).toBe(0);
    registerDesignSnapshotProvider(() => ({ front: { photos: [], texts: [] }, back: { photos: [], texts: [] }, aiResult: null }));
    await stashDesignForRedirect();
    expect(sessionStorage.length).toBe(0);
    expect(await consumeDesignRecovery()).toBeNull();
  });

  it("unregister makes a later sign-in a no-op", async () => {
    const off = registerDesignSnapshotProvider(() => snapshot());
    off();
    await stashDesignForRedirect();
    expect(sessionStorage.length).toBe(0);
  });

  it("degrades instead of throwing: drops the AI result first, then photos largest-first, and reports it", async () => {
    const big = photo(5000, "big");
    const mid = photo(3000, "mid");
    const small = photo(1000, "small");
    const snap = snapshot({
      front: { photos: [small, big], texts: [{ id: "t", content: "keep me" }] },
      back: { photos: [mid], texts: [] },
    });
    registerDesignSnapshotProvider(() => snap);

    // Simulated quota: refuse anything over N characters. Full payload is
    // ~10.7k; minus the AI result ~9.2k; minus `big` ~4.9k; minus `mid` ~1.9k.
    const LIMIT = 4000;
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === "maika-design-recovery-payload" && v.length > LIMIT) {
        throw new DOMException("quota", "QuotaExceededError");
      }
      return realSet.call(this, k, v);
    });

    await stashDesignForRedirect();
    const got = await consumeDesignRecovery();
    expect(got).not.toBeNull();
    expect(got!.dropped.aiResult).toBe(true);
    expect(got!.dropped.photos).toBe(2); // big, then mid
    expect(got!.snapshot.aiResult).toBeNull();
    expect(got!.snapshot.front.photos.map((p) => (p as { id: string; image: string }).id)).toEqual(["small-1000"]);
    expect(got!.snapshot.back.photos).toEqual([]);
    expect(got!.snapshot.front.texts).toEqual([{ id: "t", content: "keep me" }]);
  });

  it("gives up cleanly when not even the text fits, leaving no marker behind", async () => {
    registerDesignSnapshotProvider(() => snapshot());
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((k: string) => {
      if (k === "maika-design-recovery-payload") throw new DOMException("quota", "QuotaExceededError");
    });
    await stashDesignForRedirect();
    expect(sessionStorage.getItem("maika-design-recovery")).toBeNull();
    expect(await consumeDesignRecovery()).toBeNull();
  });

  it("discards a stash when the OAuth call did not navigate away", async () => {
    registerDesignSnapshotProvider(() => snapshot());
    await stashDesignForRedirect();
    discardDesignStash();
    expect(sessionStorage.length).toBe(0);
    expect(await consumeDesignRecovery()).toBeNull();
  });

  it("does not resurrect a stale stash past the TTL", async () => {
    registerDesignSnapshotProvider(() => snapshot());
    const t0 = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(t0);
    await stashDesignForRedirect();
    vi.spyOn(Date, "now").mockReturnValue(t0 + RECOVERY_TTL_MS + 1);
    expect(await consumeDesignRecovery()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("a second stash replaces the first rather than stacking", async () => {
    const a = snapshot();
    const b = snapshot({ aiResult: null });
    let cur = a;
    registerDesignSnapshotProvider(() => cur);
    await stashDesignForRedirect();
    cur = b;
    await stashDesignForRedirect();
    const got = await consumeDesignRecovery();
    expect(got!.snapshot).toEqual(b);
  });
});
