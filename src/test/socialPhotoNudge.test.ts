// @vitest-environment node
//
// DM bot, 2026-11-02 (owner test 2026-11-01 09:29 UTC): the customer sent ONE
// photo of a t-shirt with lettering + „შავზე თეთრად", the model answered
// „ამოვიღებთ…" in prose and NO sketch went out. Covered here:
//   · gemini-proxy blockGuard no longer drops a DM photo block (its photos
//     ride on params.images, so hasImage was false and the block vanished);
//   · the photo block nudge (one follow-up faq-chat call, blocks appended);
//   · "printColor" on an extract block (parse, validation, cache key, prompt);
//   · the DM prompt rules (new photo = new request, extract or not, price).
// All images are synthetic; no customer data.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import {
  KEY_COLOR_HEX,
  PRINT_COLORS,
  parseMockupBlock,
  planSketch,
  planSketches,
  resolvePrintColor,
  type RenderPlan,
} from "../../supabase/functions/meta-webhook/sketchParse";
import {
  MAX_SKETCHES_PER_REPLY,
  SKETCH_NOTICE,
  extractCacheKey,
  keyExtractedPrint,
  runSketch,
  sketchBoxes,
  type SketchBaseDeps,
  type SketchDeps,
} from "../../supabase/functions/meta-webhook/sketchFlow";
import type { ThreadRow } from "../../supabase/functions/meta-webhook/botReply";
import {
  PHOTO_BLOCK_NUDGE,
  _resetTokenWarning,
  designFences,
  needsPhotoBlockNudge,
  nudgeHistory,
  photoBlockNudge,
  runAutoReply,
  type AutoReplyDeps,
  type TriggerRow,
} from "../../supabase/functions/meta-webhook/autoReply";
import type { ChatTurn } from "../../supabase/functions/meta-webhook/botReply";
import type { OrderDeps } from "../../supabase/functions/meta-webhook/orderFlow";
import type { OrderDraft } from "../../supabase/functions/meta-webhook/orderDraft";
import { encodePng } from "../../supabase/functions/meta-webhook/pngEncode";
import { createImage, keyOutColor, type FontLike } from "../../supabase/functions/meta-webhook/sketchRaster";
import type { RgbaImage } from "../../supabase/functions/meta-webhook/pngDecode";
import { sha256Hex } from "../../supabase/functions/meta-webhook/sketchFont";
import { findProductImage } from "../../supabase/functions/meta-webhook/sketchLayout";
import {
  EXTRACT_PRINT_COLORS,
  EXTRACT_PRINT_PROMPT,
  extractPrintColor,
  extractPrintPrompt,
  socialPromptBlock,
} from "../../supabase/functions/gemini-proxy/socialChannel";
import { guardSketchBlocks, mentionsColour, photoTagged } from "../../supabase/functions/gemini-proxy/blockGuard";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const SUNDAY_NOON = new Date("2026-11-01T12:00:00+04:00");
const KEY = "messenger:159657880717306:psid1";
const PHOTO_PATH = "messenger/2026-11/tee-0.jpg";
const PHOTOS = { paths: [PHOTO_PATH], pending: [1] };
const MOCK = (o: Record<string, unknown>) => `\`\`\`maika-mockup\n${JSON.stringify(o)}\n\`\`\``;
const TEE = { photo: 1, extract: true, printColor: "White", product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "front" };
const PROSE = "ფოტოდან წარწერას ამოვიღებთ და შავ მაისურზე თეთრად დავიტანთ. ფასი — 25 ₾.";
const px = (img: RgbaImage, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/** A synthetic GPT answer: white lettering bar on the magenta key. */
function whiteOnMagenta(w = 64, h = 64): RgbaImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const text = x >= 10 && x < 54 && y >= 24 && y < 40;
    const [r, g, b] = text ? [255, 255, 255] : [255, 0, 255];
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }
  return img;
}

const boxFont = { unitsPerEm: 1000, ascender: 800, descender: -200, getPath: () => ({ commands: [] }), getAdvanceWidth: () => 600 } as unknown as FontLike;

function sketchFakes(o: Partial<SketchDeps> = {}, garment = 255) {
  const cache = new Map<string, Uint8Array>();
  const canvases: RgbaImage[] = [];
  const product = createImage(100, 120);
  for (let i = 0; i < product.data.length; i += 4) product.data.set([garment, garment, garment, 255], i);
  const state = { extracts: 0, printColors: [] as (string | undefined)[] };
  const deps: SketchDeps = {
    countSketches: async () => ({ generate: 0, text: 0 }),
    generateDesign: async () => null,
    fetchImage: async () => new Uint8Array([0xff, 0xd8, 0xff]),
    loadFont: async () => boxFont,
    decodeJpeg: () => ({ ...product, data: new Uint8ClampedArray(product.data) }),
    encodeJpeg: (img) => { canvases.push(img); return new Uint8Array([1, 2, 3]); },
    upload: async (p) => `https://storage/designs/${p}`,
    hashKey: sha256Hex,
    sendImage: async () => ({ ok: true, messageId: "mid_img" }),
    cacheGet: async (k) => cache.get(k) ?? null,
    cachePut: async (k, png) => { cache.set(k, png); },
    downloadUpload: async () => await encodePng(createImage(8, 8)),
    extractPrint: async (_c, _k, _image, _t, printColor) => { state.extracts++; state.printColors.push(printColor); return await encodePng(whiteOnMagenta()); },
    ...o,
  };
  return { deps, cache, canvases, state };
}

const base = (): SketchBaseDeps => ({
  now: () => SUNDAY_NOON,
  recordSend: async () => "r",
  markSent: async () => {},
  send: async () => ({ ok: true }),
  log: () => {},
});

// ── printColor ─────────────────────────────────────────────────────────────

describe("printColor: parse and validation", () => {
  it("a PRINT_COLORS name, case-insensitive → canonical, and implies extract", () => {
    const b = parseMockupBlock(MOCK({ photo: 1, printColor: "white" }));
    expect(b?.printColor).toBe("White");
    expect(b?.extract).toBe(true);
    expect(resolvePrintColor(" GOLD ")).toBe("Gold");
    const p = planSketch(MOCK({ photo: 1, printColor: "White", product: "T-Shirt", color: "Black" }), PHOTOS);
    expect(p?.kind === "photo" && p.block.extract && p.block.printColor).toBe("White");
  });

  it("unknown names and magenta-near colours are dropped (no recolour, no implied extract)", () => {
    for (const v of ["Magenta", "Pink", "pink", "Purple", "#FFFFFF", "თეთრი", "", 3, null]) {
      const b = parseMockupBlock(MOCK({ photo: 1, printColor: v }));
      expect(b?.printColor).toBeUndefined();
      expect(b?.extract).toBeUndefined();
    }
  });

  it("PRINT_COLORS = gemini-proxy EXTRACT_PRINT_COLORS; every one survives the magenta key-out opaque", () => {
    expect(PRINT_COLORS.map((c) => c.name)).toEqual(["Black", "White", "Red", "Blue", "Green", "Yellow", "Orange", "Gray", "Gold", "Navy"]);
    expect(EXTRACT_PRINT_COLORS).toEqual(PRINT_COLORS);
    for (const c of PRINT_COLORS) {
      const img = createImage(1, 1);
      const n = parseInt(c.hex.slice(1), 16);
      img.data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, 255], 0);
      keyOutColor(img, KEY_COLOR_HEX);
      expect(img.data[3]).toBe(255);
    }
  });

  it("the website parser ignores the field", () => {
    expect(parseMockupSuggestion(MOCK(TEE))).not.toHaveProperty("printColor");
  });

  it("cache key: without printColor exactly the old key; each print colour its own key", async () => {
    const old = (await sha256Hex(JSON.stringify({ extract: 1, path: PHOTO_PATH }))).slice(0, 40);
    expect(await extractCacheKey(PHOTO_PATH, sha256Hex)).toBe(old);
    const white = await extractCacheKey(PHOTO_PATH, sha256Hex, "White");
    expect(white).not.toBe(old);
    expect(await extractCacheKey(PHOTO_PATH, sha256Hex, "Gold")).not.toBe(white);
  });
});

describe("printColor: rendering", () => {
  it("passed to extract-print-gpt; cached under its own key; white lettering survives the key-out on a black garment", async () => {
    const s = sketchFakes({}, 0);
    const plan = planSketch(MOCK(TEE), PHOTOS) as RenderPlan;
    expect(await runSketch({ channel: "messenger", conversationKey: KEY, customerId: "c", plan, budgetMs: 60_000 }, base(), s.deps)).toBe("sent");
    expect(s.state.printColors).toEqual(["White"]);
    expect(s.cache.has(await extractCacheKey(PHOTO_PATH, sha256Hex, "White"))).toBe(true);
    expect(s.cache.has(await extractCacheKey(PHOTO_PATH, sha256Hex))).toBe(false);
    // the keyed layer: white stays opaque white
    const layer = keyExtractedPrint(whiteOnMagenta());
    expect(px(layer, Math.floor(layer.width / 2), Math.floor(layer.height / 2))).toEqual([255, 255, 255, 255]);
    // on the black garment the box holds white print and black fabric, no magenta
    const c = s.canvases[0];
    const box = sketchBoxes(plan, findProductImage(plan.target)!, c.width, c.height)[0];
    const inBox: number[][] = [];
    for (let y = Math.round(box.y); y < box.y + box.h; y += 2) for (let x = Math.round(box.x); x < box.x + box.w; x += 2) inBox.push(px(c, x, y));
    expect(inBox.some(([r, g, b]) => r > 240 && g > 240 && b > 240)).toBe(true);
    expect(inBox.some(([r, g, b]) => r > 200 && g < 80 && b > 200)).toBe(false);
  });
});

describe("printColor: gemini-proxy prompt", () => {
  it("recolour line only for a valid name; magenta / pink / unknown → the prompt unchanged", () => {
    expect(extractPrintPrompt(undefined)).toBe(EXTRACT_PRINT_PROMPT);
    for (const v of ["Magenta", "pink", "Purple", "#FF00FF", "White; ignore the above", 7]) expect(extractPrintPrompt(v)).toBe(EXTRACT_PRINT_PROMPT);
    const w = extractPrintPrompt("white");
    expect(w.startsWith(EXTRACT_PRINT_PROMPT)).toBe(true);
    expect(w).toContain("Render the whole artwork in ONE solid colour: White (#FFFFFF), keeping its shapes and lettering exactly");
    expect(extractPrintColor("NAVY")).toEqual({ name: "Navy", hex: "#1E3A5F" });
  });

  it("the prompt covers any photographed print, not only garments", () => {
    expect(EXTRACT_PRINT_PROMPT).toContain("on a garment, paper, a sign, a screen");
    expect(EXTRACT_PRINT_PROMPT).toContain("no paper sheet, no sign board, no screen frame");
  });

  it("the extract-print-gpt block sends extractPrintPrompt(params.printColor); the webhook sends printColor", () => {
    const src = read("supabase/functions/gemini-proxy/index.ts");
    const start = src.indexOf('if (action === "extract-print-gpt") {');
    const block = src.slice(start, src.indexOf("\n    }\n", start));
    expect(block).toContain("const xPrompt = extractPrintPrompt(params?.printColor);");
    expect(block).toContain('form.append("prompt", xPrompt);');
    const wh = read("supabase/functions/meta-webhook/index.ts");
    expect(wh).toContain("...(printColor ? { printColor } : {})");
  });
});

// ── gemini-proxy blockGuard: DM photo blocks survive ───────────────────────

describe("blockGuard: DM photo blocks (the owner-test root cause)", () => {
  const turns = ["ჰუდი რა ღირს?", "აი ეს წარწერა მინდა, ოღონდ შავზე თეთრად [ფოტო 1]\n[თანდართული: ფოტო 1]"];

  it("a photo block whose [ფოტო N] is in the customer's turns is kept although hasImage is false (DM params.images)", () => {
    const reply = `${PROSE}\n${MOCK(TEE)}`;
    expect(guardSketchBlocks(reply, { userTurns: turns, hasImage: false })).toBe(reply);
    expect(photoTagged({ photo: 1 }, turns)).toBe(true);
    expect(photoTagged({ photo: "1" }, ["[თანდართული: ფოტო 2, ფოტო 1]"])).toBe(true);
    expect(photoTagged({ photo: 1 }, ["[ფოტო 12]"])).toBe(false);
    expect(photoTagged({ photo: 2 }, turns)).toBe(false);
  });

  it("extract keeps the garment colour read from the photo; a plain photo block still gets White when no colour was named", () => {
    const garment = ["ესეთს დაამზადებთ? [ფოტო 1]"];
    const ex = guardSketchBlocks(MOCK({ photo: 1, extract: true, product: "Hoodie", color: "Black", side: "back" }), { userTurns: garment, hasImage: false });
    expect(ex).toContain('"color":"Black"');
    const plain = guardSketchBlocks(MOCK({ photo: 1, color: "Black" }), { userTurns: garment, hasImage: false });
    expect(plain).toContain('"color":"White"');
    expect(plain).toContain('"photo":1');
  });

  it("website path unchanged: no photo tag in the turns → the bare block is still dropped", () => {
    const out = guardSketchBlocks(`ok\n${MOCK({ photo: 1 })}`, { userTurns: ["ეს დამიბეჭდეთ"], hasImage: false });
    expect(out).not.toContain("maika-mockup");
  });

  it("the nudge turn names no colour (it must not unlock the colour rule)", () => {
    expect(mentionsColour([PHOTO_BLOCK_NUDGE])).toBe(false);
  });
});

// ── the nudge ──────────────────────────────────────────────────────────────

describe("photo block nudge: units", () => {
  it("needed only with photos sent to the model and no mockup / generate / order block", () => {
    expect(needsPhotoBlockNudge(PROSE, [1])).toBe(true);
    expect(needsPhotoBlockNudge(PROSE, [])).toBe(false);
    expect(needsPhotoBlockNudge(`${PROSE}\n${MOCK(TEE)}`, [1])).toBe(false);
    expect(needsPhotoBlockNudge("```maika-generate\n{\"prompt\":\"x\"}\n```", [1])).toBe(false);
    expect(needsPhotoBlockNudge("```maika-order\n{\"confirm\":true}\n```", [1])).toBe(false);
  });

  it("designFences keeps mockup / generate fences only, prose and maika-order dropped", () => {
    const f = designFences(`აქ ტექსტია\n${MOCK(TEE)}\n\`\`\`maika-order\n{"confirm":true}\n\`\`\`\nNONE`);
    expect(f).toEqual([MOCK(TEE)]);
    expect(designFences("NONE")).toEqual([]);
  });

  it("history: the tail starting on a customer turn + our reply + the server turn with the attached note", () => {
    const h: ChatTurn[] = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `t${i}` }) as ChatTurn);
    h.push({ role: "user", content: "x [ფოტო 1]" });
    const n = nudgeHistory(h, PROSE, [1]);
    expect(n.length).toBeLessThanOrEqual(8);
    expect(n[0].role).toBe("user");
    expect(n[n.length - 2]).toEqual({ role: "assistant", content: PROSE });
    expect(n[n.length - 1]).toEqual({ role: "user", content: `${PHOTO_BLOCK_NUDGE}\n[თანდართული: ფოტო 1]` });
  });

  it("blocks appended to the first reply; NONE / failure → the first reply unchanged", async () => {
    const logs: string[] = [];
    expect(await photoBlockNudge(PROSE, [], [1], async () => `ok\n${MOCK(TEE)}`, (m) => logs.push(m))).toBe(`${PROSE}\n\n${MOCK(TEE)}`);
    expect(await photoBlockNudge(PROSE, [], [1], async () => "NONE", (m) => logs.push(m))).toBe(PROSE);
    expect(await photoBlockNudge(PROSE, [], [1], async () => null, (m) => logs.push(m))).toBe(PROSE);
    expect(await photoBlockNudge(PROSE, [], [1], async () => { throw new Error("x"); }, (m) => logs.push(m))).toBe(PROSE);
    expect(logs).toEqual([
      "photo block nudge: 1 block added (1 extra faq-chat call)",
      "photo block nudge: none (1 extra faq-chat call)",
      "photo block nudge: failed (1 extra faq-chat call)",
      "photo block nudge: failed (1 extra faq-chat call)",
    ]);
  });

  it("the server turn: new photo = new request, NONE when no print is wanted", () => {
    expect(PHOTO_BLOCK_NUDGE.startsWith("[სისტემა:")).toBe(true);
    expect(PHOTO_BLOCK_NUDGE).toContain("maika-mockup");
    expect(PHOTO_BLOCK_NUDGE).toContain("\"printColor\"");
    expect(PHOTO_BLOCK_NUDGE).toContain("არასოდეს ისტორიის ადრინდელი, სხვა მოთხოვნიდან");
    expect(PHOTO_BLOCK_NUDGE).toContain("დაწერე მხოლოდ NONE");
  });
});

const row = (o: Partial<ThreadRow> & { meta_message_id: string; sent_at: string }): ThreadRow => ({
  direction: "in", text: null, attachments: [], unsupported: false, ...o,
});
const TEXT = "აი ეს წარწერა მინდა, ოღონდ შავზე თეთრად და ფასები მაინტერესებს";
const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m2", text: TEXT, sent_at: "2026-11-01T07:59:50.000Z",
};
const thread: ThreadRow[] = [
  row({ meta_message_id: "m0", text: "ჰუდი რა ღირს?", sent_at: "2026-11-01T07:00:00.000Z" }),
  row({ meta_message_id: "o1", direction: "out", text: "GILDAN Hoodie — 45 ₾.", sent_at: "2026-11-01T07:00:20.000Z" }),
  row({
    meta_message_id: "m2", text: TEXT, sent_at: trigger.sent_at,
    attachments: [{ type: "image", url: "https://cdn.example/x.jpg", path: PHOTO_PATH, stored: true }] as ThreadRow["attachments"],
  }),
];

function autoDeps(answers: (string | null)[], sketch: SketchDeps, o: Partial<AutoReplyDeps> = {}) {
  const sent: string[] = [];
  const asks: { history: ChatTurn[]; images?: string[] }[] = [];
  const logs: string[] = [];
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
    recordSend: async () => "r",
    markSent: async () => {},
    askBot: async (_c, _k, history, _s, opts) => { asks.push({ history, images: opts?.images }); return answers[Math.min(asks.length - 1, answers.length - 1)]; },
    send: async (_c, _to, text) => { sent.push(text); return { ok: true, messageId: `mid${sent.length}` }; },
    log: (_l, m) => { logs.push(m); },
    sketch,
    ...o,
  };
  return { deps, sent, asks, logs };
}

describe("photo block nudge: through runAutoReply", () => {
  beforeEach(() => _resetTokenWarning());

  it("owner test: prose only → ONE follow-up with the same images; its block drives the sketch; the prose is the first reply's", async () => {
    const s = sketchFakes({}, 0);
    const a = autoDeps([PROSE, `კარგი\n${MOCK(TEE)}`], s.deps);
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.asks).toHaveLength(2);
    expect(a.asks[1].images).toEqual(a.asks[0].images);
    expect(a.asks[1].images?.length).toBe(1);
    const last = a.asks[1].history[a.asks[1].history.length - 1];
    expect(last.role).toBe("user");
    expect(last.content.startsWith(PHOTO_BLOCK_NUDGE)).toBe(true);
    expect(a.asks[1].history[a.asks[1].history.length - 2]).toEqual({ role: "assistant", content: PROSE });
    expect(s.state.printColors).toEqual(["White"]);
    expect(a.sent[0]).toBe(`${PROSE}\n${SKETCH_NOTICE}`);
    expect(a.sent.join(" ")).not.toContain("სისტემა");
    expect(a.sent.join(" ")).not.toContain("კარგი");
    expect(a.logs).toContain("photo block nudge: 1 block added (1 extra faq-chat call) (messenger)");
  });

  it("NONE → the first reply unchanged, no sketch; never more than one follow-up", async () => {
    const s = sketchFakes();
    const a = autoDeps([PROSE, "NONE"], s.deps);
    await runAutoReply(trigger, a.deps);
    expect(a.asks).toHaveLength(2);
    expect(a.sent).toEqual([PROSE]);
    expect(s.state.extracts).toBe(0);
    const b = autoDeps([PROSE, "ისევ მხოლოდ ტექსტი"], sketchFakes().deps);
    await runAutoReply(trigger, b.deps);
    expect(b.asks).toHaveLength(2);
  });

  it("no nudge when the first reply has a block, or no photo went to the model", async () => {
    const a = autoDeps([`${PROSE}\n${MOCK(TEE)}`], sketchFakes().deps);
    await runAutoReply(trigger, a.deps);
    expect(a.asks).toHaveLength(1);
    const noPhoto = thread.slice(0, 1);
    const t0 = { ...trigger, meta_message_id: "m0", sent_at: thread[0].sent_at, text: "ჰუდი რა ღირს?" };
    const b = autoDeps(["45 ₾."], sketchFakes().deps, { loadThread: async () => noPhoto });
    await runAutoReply(t0, b.deps);
    expect(b.asks).toHaveLength(1);
    // no download dep → no images → no nudge
    const c = autoDeps([PROSE], sketchFakes({ downloadUpload: undefined }).deps);
    await runAutoReply(trigger, c.deps);
    expect(c.asks).toHaveLength(1);
  });

  it("no nudge on the handoff path (no model call at all)", async () => {
    const t = { ...trigger, text: "ოპერატორი" };
    const th = [...thread.slice(0, 2), row({ ...thread[2], text: "ოპერატორი" })];
    const a = autoDeps([PROSE], sketchFakes().deps, { loadThread: async () => th });
    expect(await runAutoReply(t, a.deps)).toBe("handoff");
    expect(a.asks).toHaveLength(0);
  });

  it("no nudge on the order paths: a maika-order reply, or an order waiting for the transfer", async () => {
    const draft = (status: OrderDraft["status"], cart: string | null): OrderDraft => ({
      id: "d1", conversation_key: KEY, channel: "messenger", status, items: [], lines: null,
      delivery_type: null, delivery_price: null, total: 50, customer: {}, receipt: null, cart_id: cart,
      created_at: SUNDAY_NOON.toISOString(), updated_at: SUNDAY_NOON.toISOString(),
    });
    const orders = (d: OrderDraft | null) => ({
      loadDraft: async () => d,
      createDraft: async () => d,
      updateDraft: async () => true,
      insertOrders: async () => true,
      insertAttribution: async () => true,
      newId: () => "00000000-0000-4000-8000-000000000001",
      hashKey: sha256Hex,
    }) as unknown as OrderDeps;
    const waiting = autoDeps([PROSE, MOCK(TEE)], sketchFakes().deps, { order: orders(draft("awaiting_payment", "11111111-2222-4333-8444-555555555555")) });
    await runAutoReply(trigger, waiting.deps);
    expect(waiting.asks).toHaveLength(1);
    const orderReply = autoDeps(["```maika-order\n{\"confirm\":false,\"items\":[{\"sketch\":1,\"size\":\"M\",\"qty\":1}]}\n```", MOCK(TEE)], sketchFakes().deps, { order: orders(null) });
    await runAutoReply(trigger, orderReply.deps);
    expect(orderReply.asks).toHaveLength(1);
  });
});

// ── DM prompt ──────────────────────────────────────────────────────────────

describe("DM prompt 2026-11-02: new photo = new request, extract or not, print colour, price", () => {
  const dm = socialPromptBlock("messenger", "sunday");

  it("a new photo starts a new request; an earlier, different product is never carried over", () => {
    expect(dm).toContain("A NEW PHOTO STARTS A NEW REQUEST");
    expect(dm).toContain("never from an earlier, different request in the history");
    expect(dm).toContain("„იგივე ჰუდზე\", „ისიც\"");
    expect(dm).toContain("{\"photo\":1,\"extract\":true,\"printColor\":\"White\",\"product\":\"T-Shirt\",\"subProduct\":\"GILDAN\",\"color\":\"Black\",\"side\":\"front\"}");
    expect(dm).toContain("they did not say in THIS burst which product");
  });

  it("extract whenever it is not clean flat artwork; recolour via printColor; never promise without the block", () => {
    expect(dm).toContain("EXTRACT OR NOT: \"extract\": true whenever the photo is NOT a clean flat artwork ready to print");
    expect(dm).toContain("lettering / a logo photographed on paper, a sign or a screen");
    expect(dm).toContain("\"printColor\" with ONE of White, Black, Red, Blue, Green, Yellow, Orange, Gray, Gold, Navy");
    expect(dm).toContain("Pink / purple / magenta cannot be done in the sketch");
    expect(dm).toContain("{\"photo\":1,\"extract\":true,\"printColor\":\"White\",\"product\":\"Hoodie\",\"subProduct\":\"GILDAN Hoodie\",\"color\":\"Black\",\"side\":\"front\"}");
    expect(dm).toContain("NEVER promise a sketch, an extraction or a recolour in words („ამოვიღებთ\"");
  });

  it("price for a product type: the default brand's one line, never the model list unless asked; prices from the KB", () => {
    expect(dm).toContain("A product TYPE without a brand („ჰუდი\", „მაისური\") → the price of the default brand only");
    expect(dm).toContain("NEVER list the models / brands one by one unless they explicitly ask which models or brands exist");
    expect(dm).toContain("never invent a number");
  });

  it("the prompt's t-shirt example is a valid plan: black T-Shirt, white print, extract", () => {
    const plans = planSketches(dm, { paths: ["a.jpg", "b.jpg"], pending: [1, 2] }, MAX_SKETCHES_PER_REPLY);
    const tee = plans.find((p) => p.kind === "photo" && p.block.printColor === "White");
    expect(tee && tee.kind === "photo" && tee.target).toEqual({ product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "front" });
    expect(tee && tee.kind === "photo" && tee.block.extract).toBe(true);
  });
});
