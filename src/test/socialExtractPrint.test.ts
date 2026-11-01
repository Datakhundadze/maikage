// @vitest-environment node
//
// DM bot, 2026-11-01: "extract the print from a garment photo". A customer
// photo of a READY garment → a photo block with "extract": true → gemini-proxy
// extract-print-gpt (GPT Image edit, print alone on magenta) → keyed + trimmed
// here, cached per photo, placed like a drawing, and the same transparent PNG
// is the order's print file. All images are synthetic.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import { parseMockupBlock, planSketch, planSketches, type RenderPlan } from "../../supabase/functions/meta-webhook/sketchParse";
import {
  MAX_GENERATE_SKETCHES,
  MAX_SKETCHES_PER_REPLY,
  SKETCH_MARKER,
  SKETCH_NOTICE,
  capKindOf,
  countSketchRows,
  extractCacheKey,
  isExtractPlan,
  keyExtractedPrint,
  runSketch,
  sketchBoxes,
  type SketchBaseDeps,
  type SketchDeps,
} from "../../supabase/functions/meta-webhook/sketchFlow";
import { DESIGN_LINK_LINE, HANDOFF_REASON_SKETCH_CAP, sketchCapMessage, type ThreadRow } from "../../supabase/functions/meta-webhook/botReply";
import { _resetTokenWarning, runAutoReply, type AutoReplyDeps, type TriggerRow } from "../../supabase/functions/meta-webhook/autoReply";
import { decodePng, isPng, type RgbaImage } from "../../supabase/functions/meta-webhook/pngDecode";
import { encodePng } from "../../supabase/functions/meta-webhook/pngEncode";
import { createImage, type FontLike } from "../../supabase/functions/meta-webhook/sketchRaster";
import { sha256Hex } from "../../supabase/functions/meta-webhook/sketchFont";
import { findProductImage } from "../../supabase/functions/meta-webhook/sketchLayout";
import { addSketch, sameDesign, sideFromPlan, sideSummary, type DraftItem, type OrderDraft } from "../../supabase/functions/meta-webhook/orderDraft";
import { promptFor, type OrderDeps } from "../../supabase/functions/meta-webhook/orderFlow";
import { makePrintFile, type PrintDeps } from "../../supabase/functions/meta-webhook/printFile";
import {
  EXTRACT_PRINT_PROMPT,
  SOCIAL_EXTRACT_ACTION,
  resolveTrustedSocialExtract,
  socialPromptBlock,
} from "../../supabase/functions/gemini-proxy/socialChannel";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SUNDAY_NOON = new Date("2026-11-01T12:00:00+04:00");
const KEY = "messenger:159657880717306:psid1";
const PHOTO_PATH = "messenger/2026-11/hoodie-0.jpg";
const PHOTOS = { paths: [PHOTO_PATH], pending: [1] };

const MOCK = (o: Record<string, unknown>) => `აი 👇\n\`\`\`maika-mockup\n${JSON.stringify(o)}\n\`\`\``;
const HOODIE_BACK = { photo: 1, extract: true, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" };

/** A synthetic GPT answer: magenta field, a red "logo" block and a white "lettering" bar. */
function gptPrint(w = 64, h = 64): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const logo = x >= 20 && x < 44 && y >= 12 && y < 36;
    const text = x >= 12 && x < 52 && y >= 44 && y < 50;
    const [r, g, b] = logo ? [200, 30, 30] : text ? [255, 255, 255] : [255, 0, 255];
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return img;
}
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

const boxFont: FontLike = {
  unitsPerEm: 1000, ascender: 800, descender: -200,
  getPath: () => ({ commands: [] }),
  getAdvanceWidth: () => 600,
} as unknown as FontLike;

function sketchFakes(o: Partial<SketchDeps> = {}) {
  const calls: string[] = [];
  const cache = new Map<string, Uint8Array>();
  const canvases: RgbaImage[] = [];
  const product = createImage(100, 120);
  product.data.fill(255);
  const state = { extracts: 0, lastImage: "" };
  const deps: SketchDeps = {
    countSketches: async () => ({ generate: 0, text: 0 }),
    generateDesign: async () => { calls.push("generate"); return null; },
    fetchImage: async (url) => { calls.push(`fetch:${url}`); return new Uint8Array([0xff, 0xd8, 0xff]); },
    loadFont: async () => boxFont,
    decodeJpeg: () => ({ ...product, data: new Uint8ClampedArray(product.data) }),
    encodeJpeg: (img) => { canvases.push(img); return new Uint8Array([1, 2, 3]); },
    upload: async (p) => `https://storage/designs/${p}`,
    hashKey: sha256Hex,
    sendImage: async (_c, _to, url) => { calls.push(`image:${url}`); return { ok: true, messageId: `mid_img${calls.length}` }; },
    cacheGet: async (k) => cache.get(k) ?? null,
    cachePut: async (k, png) => { calls.push("cachePut"); cache.set(k, png); },
    downloadUpload: async (p) => { calls.push(`download:${p}`); return await encodePng(createImage(8, 8)); },
    extractPrint: async (_c, _k, image) => { state.extracts++; state.lastImage = image; return await encodePng(gptPrint()); },
    ...o,
  };
  return { deps, calls, cache, canvases, state };
}

const base = (): SketchBaseDeps & { records: string[] } => {
  const records: string[] = [];
  return {
    records,
    now: () => SUNDAY_NOON,
    recordSend: async (_k, _kind, text) => { records.push(text); return "r"; },
    markSent: async () => {},
    send: async () => ({ ok: true }),
    log: () => {},
  };
};

// ── parsing ────────────────────────────────────────────────────────────────

describe("extract: block parsing and plans", () => {
  it('"extract": true / "true" parses; anything else is absent', () => {
    expect(parseMockupBlock(MOCK({ photo: 1, extract: true }))?.extract).toBe(true);
    expect(parseMockupBlock(MOCK({ photo: 1, extract: "true" }))?.extract).toBe(true);
    for (const v of [false, "no", 1, null]) expect(parseMockupBlock(MOCK({ photo: 1, extract: v }))?.extract).toBeUndefined();
  });

  it("a photo block with extract → a photo plan with block.extract, product / colour / side from the block", () => {
    const p = planSketch(MOCK(HOODIE_BACK), PHOTOS);
    expect(p?.kind).toBe("photo");
    if (p?.kind !== "photo") return;
    expect(p.block.extract).toBe(true);
    expect(p.path).toBe(PHOTO_PATH);
    expect(p.target).toEqual({ product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" });
    expect(isExtractPlan(p)).toBe(true);
    // the burst's one photo is meant when "photo" is left out
    const implied = planSketch(MOCK({ extract: true, product: "Hoodie", color: "Black", side: "back" }), PHOTOS);
    expect(implied?.kind === "photo" && implied.block.extract && implied.block.photo).toBe(1);
  });

  it("extract drops removeWhite; AI edits stay unsupported; on a lettering block it is ignored", () => {
    const p = planSketch(MOCK({ ...HOODIE_BACK, removeWhite: true }), PHOTOS);
    expect(p?.kind === "photo" && p.block.removeWhite).toBeFalsy();
    expect(planSketch(MOCK({ ...HOODIE_BACK, editPrompt: "x" }), PHOTOS)).toEqual({ kind: "unsupported", reason: "photo_edit" });
    const t = planSketch(MOCK({ text: "ანა", extract: true }), PHOTOS);
    expect(t?.kind).toBe("text");
    expect(t && t.kind !== "unsupported" && isExtractPlan(t)).toBe(false);
  });

  it("the website ignores the field", () => {
    expect(parseMockupSuggestion(MOCK(HOODIE_BACK))).toEqual(parseMockupSuggestion(MOCK({ ...HOODIE_BACK, extract: undefined })));
    expect(parseMockupSuggestion(MOCK(HOODIE_BACK))).not.toHaveProperty("extract");
  });
});

// ── keying ─────────────────────────────────────────────────────────────────

describe("extract: magenta key + trim", () => {
  it("magenta → transparent, the white lettering stays opaque white, the logo red, padding trimmed", () => {
    const layer = keyExtractedPrint(gptPrint());
    expect(layer.width).toBeLessThan(64);
    expect(layer.height).toBeLessThan(64);
    expect(px(layer, 0, 0)[3]).toBe(0);
    // find a white and a red pixel in the layer
    let white = false, red = false;
    for (let i = 0; i < layer.data.length; i += 4) {
      const [r, g, b, a] = layer.data.slice(i, i + 4);
      if (a === 255 && r === 255 && g === 255 && b === 255) white = true;
      if (a === 255 && r === 200 && g === 30 && b === 30) red = true;
    }
    expect(white).toBe(true);
    expect(red).toBe(true);
  });

  it("all magenta → extract_empty", () => {
    const img = createImage(10, 10);
    for (let i = 0; i < img.data.length; i += 4) img.data.set([255, 0, 255, 255], i);
    expect(() => keyExtractedPrint(img)).toThrow("extract_empty");
  });

  it("CPU: a 1024² GPT answer keys + trims well inside the pixel budget", () => {
    const big = gptPrint(1024, 1024);
    const t0 = performance.now();
    keyExtractedPrint(big);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

// ── rendering ──────────────────────────────────────────────────────────────

describe("extract: rendering", () => {
  it("photo → extract dep (data URL) → keyed print in the back box; the keyed PNG is cached by photo path", async () => {
    const s = sketchFakes();
    const b = base();
    const plan = planSketch(MOCK(HOODIE_BACK), PHOTOS) as RenderPlan;
    expect(await runSketch({ channel: "messenger", conversationKey: KEY, customerId: "c", plan, budgetMs: 60_000 }, b, s.deps)).toBe("sent");
    expect(s.state.extracts).toBe(1);
    expect(s.state.lastImage.startsWith("data:image/png;base64,")).toBe(true);
    expect(s.calls).toContain(`download:${PHOTO_PATH}`);
    expect(s.calls).not.toContain("generate");
    expect(b.records).toEqual([SKETCH_MARKER.extract]);
    // cached: the KEYED transparent PNG, under extractCacheKey(path)
    const k = await extractCacheKey(PHOTO_PATH, sha256Hex);
    const cached = s.cache.get(k);
    expect(cached && isPng(cached)).toBe(true);
    const dec = await decodePng(cached!);
    expect(px(dec, 0, 0)[3]).toBe(0);
    // the print sits in the box on the garment
    const c = s.canvases[0];
    const box = sketchBoxes(plan, findProductImage(plan.target)!, c.width, c.height)[0];
    const inBox: number[][] = [];
    for (let y = Math.round(box.y); y < box.y + box.h; y += 4) for (let x = Math.round(box.x); x < box.x + box.w; x += 4) inBox.push(px(c, x, y));
    expect(inBox.some(([r, g, bl]) => r > 150 && g < 80 && bl < 80)).toBe(true); // the red logo
  });

  it("extract failure / no dep → the link line, reason logged without the path", async () => {
    const logs: string[] = [];
    const sent: string[] = [];
    const b: SketchBaseDeps = { ...base(), send: async (_c, _t, text) => { sent.push(text); return { ok: true }; }, log: (_l, m) => { logs.push(m); } };
    const plan = planSketch(MOCK(HOODIE_BACK), PHOTOS) as RenderPlan;
    const ctx = { channel: "messenger" as const, conversationKey: KEY, customerId: "c", plan, budgetMs: 60_000 };
    expect(await runSketch(ctx, b, sketchFakes({ extractPrint: async () => null }).deps)).toBe("extract_failed");
    expect(await runSketch(ctx, b, sketchFakes({ extractPrint: undefined }).deps)).toBe("extract_unavailable");
    expect(sent).toEqual([DESIGN_LINK_LINE, DESIGN_LINK_LINE]);
    expect(logs.join(" ")).not.toContain("messenger/2026-11");
  });
});

// ── caps ───────────────────────────────────────────────────────────────────

describe("extract: caps", () => {
  it("a fresh extraction counts as a generation; a cached one as a mockup; the marker counts as generate", () => {
    const plan = planSketch(MOCK(HOODIE_BACK), PHOTOS) as RenderPlan;
    const plain = planSketch(MOCK({ photo: 1, color: "Black" }), PHOTOS) as RenderPlan;
    expect(capKindOf(plan, false)).toBe("generate");
    expect(capKindOf(plan, true)).toBe("text");
    expect(capKindOf(plain, false)).toBe("text");
    expect(countSketchRows([{ text: SKETCH_MARKER.extract }, { text: SKETCH_MARKER.photo }])).toEqual({ generate: 1, text: 1 });
  });
});

// ── through runAutoReply, with the draft and the print file ────────────────

const row = (o: Partial<ThreadRow> & { meta_message_id: string; sent_at: string }): ThreadRow => ({
  direction: "in", text: null, attachments: [], unsupported: false, ...o,
});
const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m1", text: "ესეთს დაამზადებთ? რა დამიჯდება?", sent_at: "2026-11-01T07:59:50.000Z",
};
const thread = [row({
  meta_message_id: "m1", text: "ესეთს დაამზადებთ? რა დამიჯდება?", sent_at: trigger.sent_at,
  attachments: [{ type: "image", url: "https://cdn.example/x.jpg?oh=SECRET", path: PHOTO_PATH, stored: true }] as ThreadRow["attachments"],
})];

function fakeOrders() {
  const drafts: OrderDraft[] = [];
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  const deps = {
    loadDraft: async () => (drafts.length ? clone(drafts[drafts.length - 1]) : null),
    createDraft: async (r: { conversation_key: string; channel: "messenger" | "instagram"; items?: DraftItem[] }) => {
      if (drafts.length) return clone(drafts[0]);
      const d: OrderDraft = {
        id: "d1", conversation_key: r.conversation_key, channel: r.channel, status: "collecting", items: r.items ?? [], lines: null,
        delivery_type: null, delivery_price: null, total: null, customer: {}, receipt: null, cart_id: null,
        created_at: SUNDAY_NOON.toISOString(), updated_at: SUNDAY_NOON.toISOString(),
      };
      drafts.push(d);
      return clone(d);
    },
    updateDraft: async (id: string, patch: Record<string, unknown>) => {
      const d = drafts.find((x) => x.id === id);
      if (!d) return false;
      Object.assign(d, clone(patch));
      return true;
    },
    insertOrders: async () => true,
    insertAttribution: async () => true,
    newId: () => "00000000-0000-4000-8000-000000000001",
    hashKey: sha256Hex,
  } as unknown as OrderDeps;
  return { deps, drafts };
}

function autoDeps(raw: string, sketch: SketchDeps, o: Partial<AutoReplyDeps> = {}) {
  const sent: string[] = [];
  const records: { kind: string; text: string }[] = [];
  const deps: AutoReplyDeps = {
    now: () => SUNDAY_NOON,
    sleep: async () => {},
    tokenSet: true,
    loadSettings: async () => ({ enabled: true, schedule: "sunday" }),
    isHandedOff: async () => false,
    insertHandoff: async () => {},
    loadThread: async () => thread,
    loadOutRows: async () => [],
    loadBotSends: async () => [],
    recordSend: async (_k, kind, text) => { records.push({ kind, text }); return `r${records.length}`; },
    markSent: async () => {},
    askBot: async () => raw,
    send: async (_c, _to, text) => { sent.push(text); return { ok: true, messageId: `mid${sent.length}` }; },
    log: () => {},
    sketch,
    ...o,
  };
  return { deps, sent, records };
}

describe("extract: through runAutoReply", () => {
  beforeEach(() => _resetTokenWarning());

  it("garment photo → one extraction, the sketch, the draft side; a size / side change re-uses it; the print file is the keyed PNG", async () => {
    const s = sketchFakes();
    const orders = fakeOrders();
    const a = autoDeps(`შავი ჰუდი, ზურგზე ლოგო და წარწერა — ესკიზს ფოტოდან ვამზადებ.${MOCK(HOODIE_BACK)}`, s.deps, { order: orders.deps });
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.sent[0]).toContain(SKETCH_NOTICE);
    expect(s.state.extracts).toBe(1);
    expect(a.records.filter((r) => r.kind === "sketch").map((r) => r.text)).toEqual([SKETCH_MARKER.extract]);
    const k = await extractCacheKey(PHOTO_PATH, sha256Hex);
    expect(s.cache.has(k)).toBe(true);
    // the draft side: photo + extract + the cache key of the keyed print
    const back = orders.drafts[0].items[0].sides.back!;
    expect(back).toMatchObject({ kind: "photo", photo: 1, photoPath: PHOTO_PATH, extract: true, cacheKey: k });
    expect(orders.drafts[0].items[0]).toMatchObject({ product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black" });

    // bigger, then the front: no second GPT call, counted as mockups, same draft item
    const t2 = { ...trigger, meta_message_id: "m2", sent_at: "2026-11-01T08:05:00.000Z" };
    const b = autoDeps(MOCK({ ...HOODIE_BACK, size: "large" }), s.deps, { order: orders.deps, loadThread: async () => [...thread, row({ meta_message_id: "m2", text: "უფრო დიდი", sent_at: t2.sent_at })] });
    await runAutoReply(t2, b.deps);
    const t3 = { ...trigger, meta_message_id: "m3", sent_at: "2026-11-01T08:06:00.000Z" };
    const c = autoDeps(MOCK({ ...HOODIE_BACK, side: "front" }), s.deps, { order: orders.deps, loadThread: async () => [...thread, row({ meta_message_id: "m3", text: "წინაც", sent_at: t3.sent_at })] });
    await runAutoReply(t3, c.deps);
    expect(s.state.extracts).toBe(1);
    expect([...b.records, ...c.records].filter((r) => r.kind === "sketch").map((r) => r.text)).toEqual([SKETCH_MARKER.photo, SKETCH_MARKER.photo]);
    expect(orders.drafts[0].items).toHaveLength(1);
    expect(orders.drafts[0].items[0].sides.back?.size).toBe("large");
    expect(orders.drafts[0].items[0].sides.front).toMatchObject({ extract: true, cacheKey: k });

    // the order's print file = the cached keyed PNG, byte for byte; the raw photo is never read
    const uploads: { path: string; bytes: Uint8Array; type: string }[] = [];
    let photoReads = 0;
    const p: PrintDeps = {
      now: () => 0,
      loadFont: async () => null,
      decodeJpeg: () => { throw new Error("no"); },
      cacheGet: s.deps.cacheGet,
      downloadUpload: async () => { photoReads++; return null; },
      upload: async (pth, bytes, type) => { uploads.push({ path: pth, bytes, type }); return `https://pub/${pth}`; },
      hashKey: sha256Hex,
    };
    expect(await makePrintFile("F", 1, orders.drafts[0].items[0], "back", p, { ms: 0 })).toEqual({ url: "https://pub/F/item1-back.png" });
    expect(uploads[0].type).toBe("image/png");
    expect(Buffer.from(uploads[0].bytes).equals(Buffer.from(s.cache.get(k)!))).toBe(true);
    expect(photoReads).toBe(0);
    // not cached → left to the operator, never the raw garment photo
    const lost: DraftItem = JSON.parse(JSON.stringify(orders.drafts[0].items[0]));
    lost.sides.back!.cacheKey = "0".repeat(40);
    expect(await makePrintFile("F", 1, lost, "back", p, { ms: 0 })).toEqual({ skipped: "extract_not_cached" });
    expect(photoReads).toBe(0);
  });

  it("generate cap (5) reached: no extraction, the cap text + handoff; a cached print still goes (mockup)", async () => {
    expect(MAX_GENERATE_SKETCHES).toBe(5);
    const handoffs: string[] = [];
    const capped = sketchFakes({ countSketches: async () => ({ generate: MAX_GENERATE_SKETCHES, text: 0 }) });
    const a = autoDeps(MOCK(HOODIE_BACK), capped.deps, { insertHandoff: async (_k, r) => { handoffs.push(r); } });
    await runAutoReply(trigger, a.deps);
    expect(capped.state.extracts).toBe(0);
    expect(a.sent).toEqual([`აი 👇\n${sketchCapMessage("sunday")}`]);
    expect(a.sent.join("\n")).not.toContain(DESIGN_LINK_LINE);
    expect(handoffs).toEqual([HANDOFF_REASON_SKETCH_CAP]);

    const warm = sketchFakes({ countSketches: async () => ({ generate: MAX_GENERATE_SKETCHES, text: 0 }) });
    warm.cache.set(await extractCacheKey(PHOTO_PATH, sha256Hex), await encodePng(keyExtractedPrint(gptPrint())));
    const warmHandoffs: string[] = [];
    const b = autoDeps(MOCK(HOODIE_BACK), warm.deps, { insertHandoff: async (_k, r) => { warmHandoffs.push(r); } });
    await runAutoReply(trigger, b.deps);
    expect(warmHandoffs).toEqual([]);
    expect(warm.state.extracts).toBe(0);
    expect(warm.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
    expect(b.records.find((r) => r.kind === "sketch")?.text).toBe(SKETCH_MARKER.photo);
  });

  it("two fresh extractions in one reply both count: the second is capped → cap text once, after the image, + handoff", async () => {
    const handoffs: string[] = [];
    const s = sketchFakes({ countSketches: async () => ({ generate: MAX_GENERATE_SKETCHES - 1, text: 0 }) });
    const a = autoDeps(`x${MOCK(HOODIE_BACK)}${MOCK({ ...HOODIE_BACK, photo: 2 })}${MOCK({ ...HOODIE_BACK, photo: 9 })}`, s.deps, {
      insertHandoff: async (_k, r) => { handoffs.push(r); },
      loadThread: async () => [row({
        meta_message_id: "m1", text: "ესენი", sent_at: trigger.sent_at,
        attachments: [
          { type: "image", url: "u1", path: PHOTO_PATH, stored: true },
          { type: "image", url: "u2", path: "messenger/2026-11/second-0.jpg", stored: true },
        ] as ThreadRow["attachments"],
      })],
    });
    await runAutoReply(trigger, a.deps);
    expect(s.state.extracts).toBe(1);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
    // photo 9 is unknown (would owe the link line) — the cap text replaces it: one follow-up line only
    expect(a.sent).toHaveLength(2);
    expect(a.sent[0].endsWith(`\n${SKETCH_NOTICE}`)).toBe(true);
    expect(a.sent[1]).toBe(sketchCapMessage("sunday"));
    expect(a.sent.join("\n")).not.toContain(DESIGN_LINK_LINE);
    expect(handoffs).toEqual([HANDOFF_REASON_SKETCH_CAP]);
  });

  it("cap hit and the allowed sketch fails: still only the cap text, never the link line too", async () => {
    const s = sketchFakes({ countSketches: async () => ({ generate: MAX_GENERATE_SKETCHES - 1, text: 0 }), extractPrint: async () => null });
    const a = autoDeps(`x${MOCK(HOODIE_BACK)}${MOCK({ ...HOODIE_BACK, photo: 2 })}`, s.deps, {
      loadThread: async () => [row({
        meta_message_id: "m1", text: "ესენი", sent_at: trigger.sent_at,
        attachments: [
          { type: "image", url: "u1", path: PHOTO_PATH, stored: true },
          { type: "image", url: "u2", path: "messenger/2026-11/second-0.jpg", stored: true },
        ] as ThreadRow["attachments"],
      })],
    });
    await runAutoReply(trigger, a.deps);
    expect(a.sent).toHaveLength(2);
    expect(a.sent[0].endsWith(`\n${SKETCH_NOTICE}`)).toBe(true);
    expect(a.sent[1]).toBe(sketchCapMessage("sunday"));
    expect(a.sent.join("\n")).not.toContain(DESIGN_LINK_LINE);
  });

  it("cap text names when the operator is back, per schedule", () => {
    expect(sketchCapMessage("sunday")).toBe("ესკიზების დღიური ლიმიტი ამოიწურა 🙏 ოპერატორს გადავეცი — ის მოგიმზადებთ და გიპასუხებთ ორშაბათს, 11:00-დან.");
    expect(sketchCapMessage("off_hours")).toContain("სამუშაო საათებში");
  });
});

// ── draft helpers ──────────────────────────────────────────────────────────

describe("extract: draft side", () => {
  it("sideFromPlan keeps extract + cacheKey; sameDesign tells extract from the raw photo; the summary and orders.prompt say so", () => {
    const ex = planSketch(MOCK(HOODIE_BACK), PHOTOS) as RenderPlan;
    const raw = planSketch(MOCK({ ...HOODIE_BACK, extract: false }), PHOTOS) as RenderPlan;
    const a = sideFromPlan(ex, "https://s/1.jpg", "t", { cacheKey: "k".repeat(40) });
    const b = sideFromPlan(raw, "https://s/2.jpg", "t", { cacheKey: "ignored" });
    expect(a.side).toMatchObject({ kind: "photo", extract: true, cacheKey: "k".repeat(40) });
    expect(b.side.extract).toBeUndefined();
    expect(b.side.cacheKey).toBeUndefined();
    expect(sameDesign(a.side, b.side)).toBe(false);
    expect(sideSummary(a.side)).toBe("ფოტო 1 (პრინტი ფოტოდან)");
    const items = addSketch([], a.target, a.side).items;
    expect(promptFor(items[0])).toContain("პრინტი ამოღებულია ფოტოდან");
  });
});

// ── gemini-proxy ───────────────────────────────────────────────────────────

describe("gemini-proxy extract-print-gpt", () => {
  const SRK = "service-role-key";
  it("trusted only with the service-role bearer and a social channel", () => {
    expect(SOCIAL_EXTRACT_ACTION).toBe("extract-print-gpt");
    expect(resolveTrustedSocialExtract("extract-print-gpt", "messenger", `Bearer ${SRK}`, SRK)).toBe("messenger");
    expect(resolveTrustedSocialExtract("extract-print-gpt", "instagram", `Bearer ${SRK}`, SRK)).toBe("instagram");
    expect(resolveTrustedSocialExtract("extract-print-gpt", "messenger", "Bearer anon", SRK)).toBeNull();
    expect(resolveTrustedSocialExtract("extract-print-gpt", "web", `Bearer ${SRK}`, SRK)).toBeNull();
    expect(resolveTrustedSocialExtract("extract-print-gpt", "messenger", null, SRK)).toBeNull();
    expect(resolveTrustedSocialExtract("extract-print-gpt", "messenger", `Bearer ${SRK}`, "")).toBeNull();
    expect(resolveTrustedSocialExtract("generate-design-gpt", "messenger", `Bearer ${SRK}`, SRK)).toBeNull();
  });

  const src = read("supabase/functions/gemini-proxy/index.ts");
  const start = src.indexOf('if (action === "extract-print-gpt") {');
  const block = src.slice(start, src.indexOf("\n    }\n", start));

  it("its own add-only block: 403 before any gateway call, edits endpoint, sunburst, medium, png, background auto", () => {
    expect(start).toBeGreaterThan(0);
    expect(src.indexOf('if (action === "extract-print-gpt") {', start + 1)).toBe(-1);
    const forbid = block.indexOf('return xJson(403, { error: "Forbidden", code: "FORBIDDEN" })');
    expect(forbid).toBeGreaterThan(0);
    expect(forbid).toBeLessThan(block.indexOf("LOVABLE_API_KEY"));
    expect(forbid).toBeLessThan(block.indexOf("await fetch("));
    expect(block).toContain('const xModel = "openai/gpt-image-2.5-sunburst";');
    expect(block).toContain('"/images/edits"');
    expect(block).toContain('form.append("quality", "medium");');
    expect(block).toContain('form.append("output_format", "png");');
    expect(block).toContain('form.append("background", "auto");');
    expect(block).not.toContain('"transparent"');
    expect(block).toContain("form.append(\"prompt\", EXTRACT_PRINT_PROMPT);");
    expect(block).toContain("logAiCall({");
    expect(block).toContain("return xJson(200, { image: img, text: \"\" });");
    // not billable (the webhook caps it); the GPT photo block next to it is unchanged
    const billable = /const BILLABLE_ACTIONS = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? "";
    expect(billable).not.toContain("extract-print-gpt");
    expect(src).toContain('if (action === "isolate-subject-gpt" || action === "restyle-gpt") {');
    expect(src).toContain('form.append("background", gIsolate ? "transparent" : "auto");');
    // no image data or URL is logged
    expect(block).not.toMatch(/console\.(log|error)\([^)]*xImage/);
  });

  it("the GPT prompt: print only, flat, letter for letter, magenta key, white stays white", () => {
    expect(EXTRACT_PRINT_PROMPT).toContain("ONLY the printed artwork");
    expect(EXTRACT_PRINT_PROMPT).toContain("letter for letter");
    expect(EXTRACT_PRINT_PROMPT).toContain("PURE MAGENTA (#FF00FF)");
    expect(EXTRACT_PRINT_PROMPT).toContain("never use magenta or pink inside the artwork");
    expect(EXTRACT_PRINT_PROMPT).toContain("solid opaque WHITE");
    expect(EXTRACT_PRINT_PROMPT).toMatch(/No garment.*no hanger/);
  });

  it("webhook calls it as the trusted social call", () => {
    const wh = read("supabase/functions/meta-webhook/index.ts");
    expect(wh).toContain('body: JSON.stringify({ action: "extract-print-gpt", params: { image, channel, session_id: conversationKey } }),');
    expect(wh).toContain("extractPrint: extractSketchPrint,");
  });
});

// ── DM prompt ──────────────────────────────────────────────────────────────

describe("DM prompt: a ready garment photo", () => {
  const dm = socialPromptBlock("messenger", "sunday");
  it("take product / colour / side from the photo, emit extract at once, never ask for the logo file", () => {
    expect(dm).toContain("Do NOT ask what product, colour or side: take them from the photo");
    expect(dm).toContain("\"extract\": true");
    expect(dm).toContain("{\"photo\":1,\"extract\":true,\"product\":\"Hoodie\",\"subProduct\":\"GILDAN Hoodie\",\"color\":\"Black\",\"side\":\"back\"}");
    expect(dm).toContain("NEVER ask for the logo / artwork file first");
    expect(dm).toContain("never say an operator must check the quality before the sketch");
    expect(dm).toContain("WITHOUT \"extract\"");
    expect(dm).not.toContain("For an exact sketch ask them to send the logo");
    expect(dm).not.toContain("Do NOT emit a photo block for a garment photo");
  });

  it("the prompt's own garment example is a valid extract plan", () => {
    const plans = planSketches(dm, { paths: ["a.jpg", "b.jpg"], pending: [1, 2] }, MAX_SKETCHES_PER_REPLY);
    const first = plans[0];
    expect(first.kind === "photo" && first.block.extract && first.target).toEqual({ product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" });
  });
});
