// @vitest-environment node
//
// DM sketch images (meta-webhook sketch*.ts): parse-before-strip, the catalog
// snapshot staying in sync with src/lib/catalog.ts, placement maths, caps,
// image echo recognition, the flow with fakes, the PNG decoder and text
// raster, the 10 s sliding debounce, and the gemini-proxy website path.

import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { buildSnapshotSource, SNAPSHOT_PATH } from "../../scripts/gen-social-catalog-snapshot";
import { ENTRIES } from "../../supabase/functions/meta-webhook/catalogSnapshot";
import { catalog, COLORS, PRODUCTS } from "@/lib/catalog";
import { contrastingTextColorHex as siteContrast } from "@/lib/textColors";
import { getStyleOptions } from "@/lib/designStyles";
import { parseGenerateSuggestion } from "@/lib/generateSuggestion";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import {
  GUARD_ISOLATE_BG,
  GUARD_NO_GARMENT,
  GUARD_SLOGAN_NO_CARD,
  REALISTIC_STYLE_OVERRIDE,
  buildGenerateParams,
  extractSlogan,
  parseGenerateBlock,
  parseMockupBlock,
  planSketch,
  productChoice,
} from "../../supabase/functions/meta-webhook/sketchParse";
import {
  containFit,
  contrastingTextColorHex,
  designCoords,
  findProductImage,
  placementBox,
  textCoords,
} from "../../supabase/functions/meta-webhook/sketchLayout";
import {
  MAX_GENERATE_SKETCHES,
  MAX_TEXT_SKETCHES,
  SKETCH_FOLLOWUP,
  SKETCH_MARKER,
  SKETCH_NOTICE,
  countSketchRows,
  runSketch,
  sketchBudgetMs,
  withinCaps,
  type SketchBaseDeps,
  type SketchDeps,
  type SketchContext,
} from "../../supabase/functions/meta-webhook/sketchFlow";
import { decodePng } from "../../supabase/functions/meta-webhook/pngDecode";
import {
  createImage,
  drawContained,
  renderTextImage,
  tintLuminance,
  type FontLike,
  type PathCommand,
} from "../../supabase/functions/meta-webhook/sketchRaster";
import { FONT_SHA256, FONT_URLS, _resetSketchFont, loadSketchFont, sha256Hex } from "../../supabase/functions/meta-webhook/sketchFont";
import {
  DESIGN_LINK_LINE,
  SKETCH_ECHO_MS,
  cleanBotReply,
  decideAutoReply,
  humanTookOver,
  isBotEcho,
  sendImageBody,
  type BotSendRecord,
  type ThreadRow,
} from "../../supabase/functions/meta-webhook/botReply";
import { DEBOUNCE_MS, _resetTokenWarning, runAutoReply, type AutoReplyDeps, type TriggerRow } from "../../supabase/functions/meta-webhook/autoReply";
import {
  billableGateApplies,
  resolveTrustedSocialChannel,
  resolveTrustedSocialSketch,
} from "../../supabase/functions/gemini-proxy/socialChannel";

const ROOT = path.resolve(__dirname, "../..");
const SUNDAY_NOON = new Date("2026-11-01T12:00:00+04:00");

// ── snapshot ───────────────────────────────────────────────────────────────

describe("catalog snapshot", () => {
  it("matches src/lib/catalog.ts byte for byte (run the generator if this fails)", () => {
    expect(readFileSync(SNAPSHOT_PATH, "utf8")).toBe(buildSnapshotSource());
  });

  it("has every catalog entry, with absolute URLs and the same zones", () => {
    let n = 0;
    for (const p of PRODUCTS) {
      const subs = catalog.getSubProducts(p.type);
      for (const sub of subs.length ? subs : [p.type]) {
        for (const color of catalog.getAvailableColors(p.type, sub)) {
          for (const view of ["front", "back"] as const) {
            const e = catalog.findProduct(p.type, sub, color, view)!;
            const s = ENTRIES.find((x) => x.type === p.type && x.sub === sub && x.color === color && x.view === view)!;
            expect(s.zone).toEqual(e.placementZone);
            if (e.imageUrl) expect(s.url).toBe(e.imageUrl.startsWith("/") ? `https://maika.ge${e.imageUrl}` : e.imageUrl);
            else expect(s.url).toBeNull();
            n++;
          }
        }
      }
    }
    expect(ENTRIES).toHaveLength(n);
    for (const e of ENTRIES) if (e.url) expect(e.url).toMatch(/^https:\/\//);
  });

  it("every https://maika.ge photo is a real file in public/ (what Lovable serves at /)", () => {
    const local = ENTRIES.filter((e) => e.url?.startsWith("https://maika.ge/"));
    expect(local.length).toBeGreaterThan(50);
    for (const e of local) {
      const rel = decodeURIComponent(e.url!.slice("https://maika.ge/".length));
      expect(existsSync(path.join(ROOT, "public", rel)), rel).toBe(true);
    }
  });

  it("style labels are the site's", () => {
    const src = readFileSync(SNAPSHOT_PATH, "utf8");
    expect(src).toContain(JSON.stringify(getStyleOptions("ge")));
  });
});

// ── parsing ────────────────────────────────────────────────────────────────

const GEN = (o: Record<string, unknown>) => `აი იდეა!\n\`\`\`maika-generate\n${JSON.stringify(o)}\n\`\`\``;
const MOCK = (o: Record<string, unknown>) => `აი ასე 👇\n\`\`\`maika-mockup\n${JSON.stringify(o)}\n\`\`\``;

describe("parse before strip", () => {
  it("the plan comes from the RAW reply; the cleaned text has no block left to parse", () => {
    const raw = GEN({ prompt: "ლომი გვირგვინით", style: "Anime", color: "black" });
    expect(planSketch(raw, false)?.kind).toBe("generate");
    const cleaned = cleanBotReply(raw);
    expect(cleaned).not.toContain("maika-generate");
    expect(planSketch(cleaned, false)).toBeNull();
  });

  it("generate block resolves exactly like the site's parser", () => {
    const raw = GEN({ prompt: "  ლომი  ", style: "anime", withBackground: "true", product: "GILDAN", color: "ლურჯი", side: "BACK", placement: "Left-Chest" });
    const site = parseGenerateSuggestion(raw)!;
    const dm = parseGenerateBlock(raw)!;
    expect(dm).toEqual({ ...site });
  });

  it("mockup block resolves exactly like the site's parser (brand alias, colour family, text colour)", () => {
    const raw = MOCK({ text: "მაიკა", product: "hammer", color: "blue", textColor: "Light Blue", placement: "small" });
    expect(parseMockupBlock(raw)).toEqual({ ...parseMockupSuggestion(raw) });
  });

  it("text mockup → text plan with the site's defaults filled in", () => {
    const p = planSketch(MOCK({ text: "გიორგი" }), false)!;
    expect(p.kind).toBe("text");
    if (p.kind === "text") expect(p.target).toEqual({ product: "T-Shirt", subProduct: "GILDAN", color: "White", side: "front" });
  });

  it("v1 skips photo mockups, edits, placeholders and order status", () => {
    expect(planSketch(MOCK({ text: "გიორგი" }), true)).toEqual({ kind: "unsupported", reason: "photo" });
    expect(planSketch(MOCK({ removeWhite: true, text: "x1" }), false)).toEqual({ kind: "unsupported", reason: "photo_edit" });
    expect(planSketch(MOCK({ text: "თქვენი ტექსტი" }), false)).toEqual({ kind: "unsupported", reason: "no_text" });
    expect(planSketch("```maika-order-status\n```\n" + MOCK({ text: "a b" }), false)).toEqual({ kind: "unsupported", reason: "order_status" });
    expect(planSketch("ფასი 25 ლარია", false)).toBeNull();
  });

  it("generate wins over mockup (the site's precedence)", () => {
    expect(planSketch(`${GEN({ prompt: "კატა" })}\n${MOCK({ text: "x y" })}`, false)?.kind).toBe("generate");
  });

  it("jersey-back mockup defaults to the back", () => {
    const p = planSketch(MOCK({ text: "ბერიძე", number: 10, placement: "jersey-back" }), false)!;
    expect(p.kind === "text" && p.target.side).toBe("back");
  });
});

describe("generation params = the website's", () => {
  const target = productChoice({});
  it("guards, slogan from quotes, Georgian style label", () => {
    const g = parseGenerateBlock(GEN({ prompt: "კატა წარწერით „მიყვარს თბილისი“", style: "Anime" }))!;
    const p = buildGenerateParams(g, target);
    expect(extractSlogan(g.prompt)).toBe("მიყვარს თბილისი");
    expect(p.text).toBe("მიყვარს თბილისი");
    expect(p.character).toBe(`${g.prompt} ${GUARD_NO_GARMENT} ${GUARD_SLOGAN_NO_CARD} ${GUARD_ISOLATE_BG}`);
    expect(p.style).toBe("ანიმე");
    expect(p.isRealistic).toBe(false);
    expect(p).toMatchObject({ scene: "", characterImages: [], sceneImage: null, styleImage: null, textImage: null, product: "T-Shirt", color: "White" });
    expect(p).not.toHaveProperty("transparent");
  });
  it("realistic → the pipeline's style override and the flag", () => {
    const p = buildGenerateParams(parseGenerateBlock(GEN({ prompt: "ძაღლი", style: "Realistic" }))!, target);
    expect(p.style).toBe(REALISTIC_STYLE_OVERRIDE);
    expect(p.isRealistic).toBe(true);
    expect(p.text).toBe("");
    expect(p.character).toBe(`ძაღლი ${GUARD_NO_GARMENT} ${GUARD_ISOLATE_BG}`);
  });
  it("with background: no isolate guard, raw label, transparent false", () => {
    const p = buildGenerateParams(parseGenerateBlock(GEN({ prompt: "ზღვა", style: "Realistic", withBackground: true }))!, target);
    expect(p.character).toBe(`ზღვა ${GUARD_NO_GARMENT}`);
    expect(p.style).toBe("რეალისტური");
    expect(p.isRealistic).toBe(true);
    expect(p.transparent).toBe(false);
  });
  it("unknown style → Auto (empty)", () => {
    expect(buildGenerateParams(parseGenerateBlock(GEN({ prompt: "კატა", style: "anime-ish" }))!, target).style).toBe("");
  });
});

// ── placement maths ────────────────────────────────────────────────────────

describe("placement fit maths", () => {
  const zone = { x: 0.5, y: 0.42, scale: 0.35 };
  it("zone-relative box (compositeMockup's maths)", () => {
    expect(placementBox(zone, { x: 0.5, y: 0.5, scale: 1, scaleY: 1 }, 1000, 1000)).toEqual({ x: 325, y: 245, w: 350, h: 350 });
    const chest = placementBox(zone, designCoords("left-chest"), 1000, 1000);
    expect(chest.w).toBeCloseTo(148.75);
    // wearer's left = viewer's right
    expect(chest.x + chest.w / 2).toBeGreaterThan(500);
    const right = placementBox(zone, designCoords("right-chest"), 1000, 1000);
    expect(right.x + right.w / 2).toBeLessThan(500);
  });
  it("contain-fit keeps the aspect and centres", () => {
    expect(containFit({ x: 0, y: 0, w: 400, h: 100 }, 200, 200)).toEqual({ x: 150, y: 0, w: 100, h: 100 });
    expect(containFit({ x: 10, y: 10, w: 100, h: 400 }, 200, 100)).toEqual({ x: 10, y: 185, w: 100, h: 50 });
    expect(containFit({ x: 0, y: 0, w: 100, h: 100 }, 0, 10).w).toBe(0);
  });
  it("text coords mirror the seeded text layer", () => {
    expect(textCoords(undefined, "T-Shirt")).toEqual({ x: 0.5, y: 0.65, scale: 0.8, scaleY: 0.24 });
    expect(textCoords("small", "T-Shirt")).toEqual({ x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 });
    expect(textCoords(undefined, "Sport").y).toBe(0.38);
    expect(textCoords("left-chest", "T-Shirt").x).toBeCloseTo(0.72);
    expect(designCoords("small")).toEqual({ x: 0.5, y: 0.5, scale: 0.425, scaleY: 0.425 });
  });
  it("product photo lookup: exact, tinted white base, front-only products", () => {
    const blackGildan = findProductImage({ product: "T-Shirt", subProduct: "GILDAN", color: "Black", side: "front" })!;
    expect(blackGildan.url).toBe("https://maika.ge/products/tshirt/gildan-white-front.png");
    expect(blackGildan.tintHex).toBe("#1a1a1a");
    const th = findProductImage({ product: "T-Shirt", subProduct: "TH", color: "Black", side: "back" })!;
    expect(th.tintHex).toBeNull();
    expect(findProductImage({ product: "Mug", subProduct: "Mug", color: "White", side: "back" })!.view).toBe("front");
  });
  it("default text colour: black on light, white on dark", () => {
    expect(contrastingTextColorHex("#FFFFFF")).toBe("#000000");
    expect(contrastingTextColorHex("#000000")).toBe("#FFFFFF");
    expect(contrastingTextColorHex(null)).toBe("#000000");
    for (const c of COLORS) expect(contrastingTextColorHex(c.hex), c.name).toBe(siteContrast(c.hex));
  });
});

// ── caps ───────────────────────────────────────────────────────────────────

describe("caps", () => {
  it("3 generated designs and 10 text mockups per 24 h; unreadable counts fail closed", () => {
    expect(MAX_GENERATE_SKETCHES).toBe(3);
    expect(MAX_TEXT_SKETCHES).toBe(10);
    expect(withinCaps("generate", { generate: 2, text: 0 })).toBe(true);
    expect(withinCaps("generate", { generate: 3, text: 0 })).toBe(false);
    expect(withinCaps("text", { generate: 3, text: 9 })).toBe(true);
    expect(withinCaps("text", { generate: 0, text: 10 })).toBe(false);
    expect(withinCaps("text", null)).toBe(false);
  });
  it("rows are counted by marker", () => {
    expect(countSketchRows([
      { text: SKETCH_MARKER.generate }, { text: SKETCH_MARKER.generate }, { text: SKETCH_MARKER.text }, { text: null },
    ])).toEqual({ generate: 2, text: 1 });
  });
  it("budget: 90 s, but never past the wall-clock budget", () => {
    expect(sketchBudgetMs(0, 10_000)).toBe(90_000);
    expect(sketchBudgetMs(0, 100_000)).toBe(40_000);
  });
});

// ── echoes ─────────────────────────────────────────────────────────────────

describe("image echo recognition", () => {
  const sends: BotSendRecord[] = [
    { meta_message_id: null, text: SKETCH_MARKER.generate, kind: "sketch", created_at: "2026-11-01T08:00:00.000Z" },
  ];
  const img = (sent_at: string, o: Record<string, unknown> = {}) => ({
    meta_message_id: "m_img", text: null, sent_at, attachments: [{ type: "image", url: "https://x" }], ...o,
  });
  it("image-only echo within 2 minutes of a sketch send is the bot's", () => {
    expect(SKETCH_ECHO_MS).toBe(120_000);
    expect(isBotEcho(img("2026-11-01T08:01:30Z"), sends)).toBe(true);
    expect(humanTookOver([img("2026-11-01T08:01:30Z")], sends, new Date("2026-11-01T09:00:00Z"))).toBe(false);
  });
  it("later than 2 minutes, or with text, or not an image → not the bot", () => {
    expect(isBotEcho(img("2026-11-01T08:02:30Z"), sends)).toBe(false);
    expect(isBotEcho(img("2026-11-01T08:00:30Z", { text: "ნახე" }), sends)).toBe(false);
    expect(isBotEcho(img("2026-11-01T08:00:30Z", { attachments: [{ type: "video", url: "u" }] }), sends)).toBe(false);
    expect(isBotEcho(img("2026-11-01T08:00:30Z", { attachments: undefined }), sends)).toBe(false);
    // only 'sketch' sends count for the time rule
    expect(isBotEcho(img("2026-11-01T08:00:30Z"), [{ ...sends[0], kind: "reply" }])).toBe(false);
  });
  it("matched by mid at any time", () => {
    expect(isBotEcho(img("2026-11-01T11:00:00Z"), [{ ...sends[0], meta_message_id: "m_img" }])).toBe(true);
  });
});

describe("image send body", () => {
  it("Messenger: is_reusable false + metadata; Instagram: url only", () => {
    expect(sendImageBody("messenger", "psid", "https://u/a.jpg")).toEqual({
      recipient: { id: "psid" }, messaging_type: "RESPONSE",
      message: { attachment: { type: "image", payload: { url: "https://u/a.jpg", is_reusable: false } }, metadata: "maika-bot" },
    });
    expect(sendImageBody("instagram", "ig", "https://u/a.jpg")).toEqual({
      recipient: { id: "ig" }, messaging_type: "RESPONSE",
      message: { attachment: { type: "image", payload: { url: "https://u/a.jpg" } } },
    });
  });
});

// ── PNG + raster ───────────────────────────────────────────────────────────

function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngOf(w: number, h: number, ctype: number, depth: number, rows: number[][], extra: [string, number[]][] = []): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([depth, ctype, 0, 0, 0], 8);
  const raw = Uint8Array.from(rows.flatMap((r) => [0, ...r]));
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...extra.map(([t, d]) => chunk(t, Uint8Array.from(d))),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array()),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

describe("PNG decoder", () => {
  it("decodes a real catalog photo (RGBA, every filter type the encoder chose)", async () => {
    const bytes = new Uint8Array(readFileSync(path.join(ROOT, "public/products/tshirt/gildan-white-front.png")));
    const img = await decodePng(bytes);
    expect([img.width, img.height]).toEqual([942, 1038]);
    expect(img.data[3]).toBe(0); // transparent corner
    const mid = (Math.floor(img.height / 2) * img.width + Math.floor(img.width / 2)) * 4;
    expect(img.data[mid + 3]).toBe(255); // the shirt itself
    expect(img.data[mid]).toBeGreaterThan(200); // white
  });
  it("palette + tRNS, grey 4-bit, RGB", async () => {
    const pal = await decodePng(pngOf(2, 1, 3, 8, [[0, 1]], [["PLTE", [255, 0, 0, 0, 0, 255]], ["tRNS", [0]]]));
    expect(Array.from(pal.data)).toEqual([255, 0, 0, 0, 0, 0, 255, 255]);
    const grey = await decodePng(pngOf(2, 1, 0, 4, [[0xf0]]));
    expect(Array.from(grey.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const rgb = await decodePng(pngOf(1, 1, 2, 8, [[1, 2, 3]]));
    expect(Array.from(rgb.data)).toEqual([1, 2, 3, 255]);
  });
  it("rejects non-PNG bytes", async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});

/** A font whose every character is a filled 60×100 box on a 100-unit em. */
const boxFont: FontLike = {
  unitsPerEm: 100, ascender: 100, descender: 0,
  getAdvanceWidth: (t, size) => [...t].length * 0.7 * size,
  getPath: (t, x, y, size) => {
    const commands: PathCommand[] = [];
    [...t].forEach((ch, i) => {
      if (ch === " ") return;
      const x0 = x + i * 0.7 * size, x1 = x0 + 0.6 * size, y0 = y - size, y1 = y;
      commands.push({ type: "M", x: x0, y: y0 }, { type: "L", x: x1, y: y0 }, { type: "L", x: x1, y: y1 }, { type: "L", x: x0, y: y1 }, { type: "Z" });
    });
    return { commands };
  },
};

describe("raster", () => {
  it("text is contain-fitted to the box and filled solid", () => {
    const img = renderTextImage(boxFont, "ab", "#FF0000", 200, 200)!;
    // "ab" is 1.3 em wide, 1 em tall → width-bound
    expect(img.width).toBe(200);
    expect(img.height).toBe(Math.ceil(200 / 1.3));
    const c = (Math.floor(img.height / 2) * img.width + 20) * 4;
    expect(Array.from(img.data.slice(c, c + 4))).toEqual([255, 0, 0, 255]);
    const gap = (Math.floor(img.height / 2) * img.width + 100) * 4; // between the two boxes
    expect(img.data[gap + 3]).toBe(0);
  });
  it("tint = luminance × colour, transparent pixels untouched", () => {
    const img = createImage(2, 1);
    img.data.set([255, 255, 255, 255, 255, 255, 255, 0]);
    tintLuminance(img, "#1a1a1a");
    expect(Array.from(img.data)).toEqual([26, 26, 26, 255, 255, 255, 255, 0]);
  });
  it("drawContained centres the design in the box", () => {
    const dst = createImage(100, 100);
    const design = createImage(10, 10);
    design.data.fill(255);
    const fit = drawContained(dst, design, { x: 0, y: 0, w: 100, h: 50 });
    expect(fit).toEqual({ x: 25, y: 0, w: 50, h: 50 });
    expect(dst.data[(10 * 100 + 50) * 4 + 3]).toBe(255);
    expect(dst.data[(10 * 100 + 10) * 4 + 3]).toBe(0);
  });
});

describe("font loader", () => {
  beforeEach(() => _resetSketchFont());
  it("pinned URLs; wrong bytes rejected, next URL tried; a failure is not cached", async () => {
    expect(FONT_URLS.every((u) => u.includes("@0.4.3/"))).toBe(true);
    const good = new TextEncoder().encode("pretend-font");
    const calls: string[] = [];
    const deps = {
      fetchBytes: async (u: string) => { calls.push(u); return u === FONT_URLS[0] ? new Uint8Array([1]) : good; },
      parse: () => boxFont,
      log: () => {},
    };
    // the real hash will not match the stand-in bytes → null, and not cached
    expect(await loadSketchFont(deps)).toBeNull();
    expect(calls).toEqual(FONT_URLS);
    expect(FONT_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    calls.length = 0;
    await loadSketchFont(deps);
    expect(calls.length).toBe(2);
  });
});

// ── flow with fakes ────────────────────────────────────────────────────────

function sketchFakes(o: Partial<SketchDeps> = {}) {
  const calls: string[] = [];
  const product = createImage(100, 120);
  product.data.fill(255);
  const design = createImage(20, 20);
  design.data.fill(200);
  const deps: SketchDeps = {
    countSketches: async () => { calls.push("count"); return { generate: 0, text: 0 }; },
    generateDesign: async (_c, _k, params) => { calls.push(`generate:${String(params.style)}`); return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); },
    fetchImage: async (url) => { calls.push(`fetch:${url}`); return new Uint8Array([0xff, 0xd8, 0xff]); },
    loadFont: async () => boxFont,
    decodeJpeg: () => ({ ...product, data: new Uint8ClampedArray(product.data) }),
    encodeJpeg: (img) => { calls.push(`jpeg:${img.width}x${img.height}`); return new Uint8Array([1, 2, 3]); },
    upload: async (p) => { calls.push(`upload:${p}`); return `https://storage/designs/${p}`; },
    hashKey: async () => "h".repeat(64),
    sendImage: async (_c, _to, url) => { calls.push(`image:${url}`); return { ok: true, messageId: "mid_img" }; },
    ...o,
  };
  return { deps, calls, design };
}

const row = (o: Partial<ThreadRow> & { meta_message_id: string; sent_at: string }): ThreadRow => ({
  direction: "in", text: null, attachments: [], unsupported: false, ...o,
});

function autoDeps(raw: string, sketch?: SketchDeps, o: Partial<AutoReplyDeps> = {}) {
  const sent: string[] = [];
  const records: { kind: string; text: string; mid?: string }[] = [];
  const sleeps: number[] = [];
  const deps: AutoReplyDeps = {
    now: () => SUNDAY_NOON,
    sleep: async (ms) => { sleeps.push(ms); },
    tokenSet: true,
    loadSettings: async () => ({ enabled: true, schedule: "sunday" }),
    isHandedOff: async () => false,
    insertHandoff: async () => {},
    loadThread: async () => [row({ meta_message_id: "m1", text: "მაისურზე ლომი მინდა", sent_at: "2026-11-01T07:59:50.000Z" })],
    loadOutRows: async () => [],
    loadBotSends: async () => [],
    recordSend: async (_k, kind, text) => { records.push({ kind, text }); return `r${records.length - 1}`; },
    markSent: async (id, mid) => { records[Number(id.slice(1))].mid = mid; },
    askBot: async () => raw,
    send: async (_c, _to, text) => { sent.push(text); return { ok: true, messageId: `mid${sent.length}` }; },
    log: () => {},
    sketch,
    ...o,
  };
  return { deps, sent, records, sleeps };
}

const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m1", text: "მაისურზე ლომი მინდა", sent_at: "2026-11-01T07:59:50.000Z",
};

describe("runAutoReply with sketches", () => {
  beforeEach(() => _resetTokenWarning());

  it("generate: text + notice first, then the image, then the follow-up", async () => {
    // a real PNG so the decoder runs end to end
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    const s = sketchFakes({ generateDesign: async (_c, _k, p) => { s.calls.push(`generate:${String(p.style)}`); return pngBytes; } });
    const a = autoDeps(GEN({ prompt: "ლომი", style: "Anime", product: "GILDAN", color: "Black" }), s.deps);
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.sent).toEqual([`აი იდეა!\n${SKETCH_NOTICE}`, SKETCH_FOLLOWUP]);
    expect(a.sent[0]).not.toContain(DESIGN_LINK_LINE);
    expect(s.calls).toContain("generate:ანიმე");
    expect(s.calls).toContain("fetch:https://maika.ge/products/tshirt/gildan-white-front.png");
    expect(s.calls.some((c) => c.startsWith("jpeg:1024x"))).toBe(true);
    expect(s.calls.find((c) => c.startsWith("upload:"))).toMatch(/^upload:social-sketches\/h{32}\/\d+\.jpg$/);
    expect(a.records.map((r) => r.kind)).toEqual(["reply", "sketch", "reply"]);
    expect(a.records[1]).toMatchObject({ text: SKETCH_MARKER.generate, mid: "mid_img" });
  });

  it("text mockup renders with the font, no generation call", async () => {
    const s = sketchFakes();
    const a = autoDeps(MOCK({ text: "გიორგი", color: "black" }), s.deps);
    await runAutoReply(trigger, a.deps);
    expect(s.calls.some((c) => c.startsWith("generate"))).toBe(false);
    expect(s.calls.some((c) => c.startsWith("image:"))).toBe(true);
    expect(a.records[1].text).toBe(SKETCH_MARKER.text);
  });

  it("over the cap → the link line, nothing rendered", async () => {
    const s = sketchFakes({ countSketches: async () => ({ generate: 3, text: 0 }) });
    const a = autoDeps(GEN({ prompt: "ლომი" }), s.deps);
    await runAutoReply(trigger, a.deps);
    expect(a.sent).toEqual([`აი იდეა!\n${DESIGN_LINK_LINE}`]);
    expect(s.calls).toEqual([]);
  });

  it("count unreadable → link line (fail closed)", async () => {
    const s = sketchFakes({ countSketches: async () => null });
    const a = autoDeps(MOCK({ text: "ანა" }), s.deps);
    await runAutoReply(trigger, a.deps);
    expect(a.sent).toEqual([`აი ასე 👇\n${DESIGN_LINK_LINE}`]);
  });

  it("generation failure → notice, then the link line; reason logged", async () => {
    const logs: string[] = [];
    const s = sketchFakes({ generateDesign: async () => null });
    const a = autoDeps(GEN({ prompt: "ლომი" }), s.deps, { log: (_l, m) => { logs.push(m); } });
    await runAutoReply(trigger, a.deps);
    expect(a.sent).toEqual([`აი იდეა!\n${SKETCH_NOTICE}`, DESIGN_LINK_LINE]);
    expect(logs.some((l) => l.includes("generate_failed"))).toBe(true);
  });

  it("no sketch deps → exactly the old behaviour (link line)", async () => {
    const a = autoDeps(GEN({ prompt: "ლომი" }));
    await runAutoReply(trigger, a.deps);
    expect(a.sent).toEqual([`აი იდეა!\n${DESIGN_LINK_LINE}`]);
  });

  it("customer sent a photo → v1 skips, link line", async () => {
    const s = sketchFakes();
    const a = autoDeps(MOCK({ text: "ანა" }), s.deps, {
      loadThread: async () => [row({ meta_message_id: "m1", text: "ეს ფოტო დაადე", attachments: [{ type: "image", url: "u" }], sent_at: trigger.sent_at })],
      loadBotSends: async () => [{ meta_message_id: "x", text: "ფოტო მივიღეთ", kind: "photo", created_at: "2026-11-01T07:00:00.000Z" }],
    });
    await runAutoReply(trigger, a.deps);
    expect(a.sent[0]).toContain(DESIGN_LINK_LINE);
    expect(s.calls).toEqual([]);
  });
});

describe("runSketch timing", () => {
  const ctx = (budgetMs: number): SketchContext => ({
    channel: "instagram", conversationKey: "instagram:1:2", customerId: "2", budgetMs,
    plan: planSketch(GEN({ prompt: "ლომი" }), false) as SketchContext["plan"],
  });
  const base = () => {
    const sent: string[] = [];
    const b: SketchBaseDeps = {
      now: () => new Date(),
      recordSend: async () => "r1",
      markSent: async () => {},
      send: async (_c, _t, text) => { sent.push(text); return { ok: true }; },
      log: () => {},
    };
    return { sent, b };
  };

  it("overall timeout → link line, and the late image is never sent", async () => {
    let imageSent = false;
    const s = sketchFakes({
      generateDesign: () => new Promise((r) => setTimeout(() => r(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 80)),
      sendImage: async () => { imageSent = true; return { ok: true }; },
    });
    const { sent, b } = base();
    expect(await runSketch(ctx(20), b, s.deps)).toBe("timeout");
    expect(sent).toEqual([DESIGN_LINK_LINE]);
    await new Promise((r) => setTimeout(r, 150));
    expect(imageSent).toBe(false);
  });

  it("no send record → nothing generated, link line", async () => {
    const s = sketchFakes();
    const { sent, b } = base();
    b.recordSend = async (_k, kind) => (kind === "sketch" ? null : "r2");
    expect(await runSketch(ctx(5000), b, s.deps)).toBe("record_failed");
    expect(s.calls.some((c) => c.startsWith("generate"))).toBe(false);
    expect(sent).toEqual([DESIGN_LINK_LINE]);
  });

  it("image send failure → link line with status in the log", async () => {
    const logs: string[] = [];
    const s = sketchFakes({ sendImage: async () => ({ ok: false, status: 400, code: "100/-/OAuthException" }) });
    const { sent, b } = base();
    b.log = (_l, m) => { logs.push(m); };
    // generateDesign returns only a PNG signature → decode fails first; use a mockup instead
    const c = { ...ctx(5000), plan: planSketch(MOCK({ text: "ანა" }), false) as SketchContext["plan"] };
    expect(await runSketch(c, b, s.deps)).toMatch(/^image_send_failed status=400/);
    expect(sent).toEqual([DESIGN_LINK_LINE]);
    expect(logs.join(" ")).toContain("status=400");
  });
});

// ── debounce ───────────────────────────────────────────────────────────────

describe("debounce 10 s, sliding", () => {
  it("waits DEBOUNCE_MS = 10 000 before answering", async () => {
    const a = autoDeps("გამარჯობა! რით დაგეხმაროთ?");
    await runAutoReply(trigger, a.deps);
    expect(DEBOUNCE_MS).toBe(10_000);
    expect(a.sleeps).toEqual([10_000]);
  });

  it("a burst of short lines gets ONE answer, 10 s after the LAST line", async () => {
    // Four lines 3 s apart; each starts its own run. A run looks at the thread
    // after its own 10 s wait: every run but the last sees a newer line.
    const lines = ["გამარჯობა", "მინდა", "მაიკაზე", "წარწერა, რა ღირს?"];
    const t0 = Date.parse("2026-11-01T08:00:00.000Z");
    const thread = lines.map((text, i) => row({ meta_message_id: `m${i}`, text, sent_at: new Date(t0 + i * 3000).toISOString() }));
    const replies: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const a = autoDeps("ფასი 25 ლარიდან.", undefined, {
        loadThread: async () => thread,
        send: async (_c, _to, text) => { replies.push(`${i}:${text}`); return { ok: true, messageId: "m" }; },
      });
      const res = await runAutoReply({ ...trigger, meta_message_id: `m${i}`, text: lines[i], sent_at: thread[i].sent_at }, a.deps);
      expect(res).toBe(i < lines.length - 1 ? "superseded" : "reply");
    }
    expect(replies).toEqual(["3:ფასი 25 ლარიდან."]);
    // the decision itself
    const base = {
      settings: { enabled: true, schedule: "sunday" }, now: SUNDAY_NOON, handedOff: false,
      outRows: [], botSends: [], tokenSet: true, thread,
    };
    expect(decideAutoReply({ ...base, trigger: { meta_message_id: "m0", sent_at: thread[0].sent_at } })).toEqual({ action: "skip", reason: "superseded" });
    expect(decideAutoReply({ ...base, trigger: { meta_message_id: "m3", sent_at: thread[3].sent_at } })).toEqual({ action: "reply" });
  });
});

// ── gemini-proxy: website path unchanged ───────────────────────────────────

describe("gemini-proxy trusted sketch call", () => {
  const KEY = "service-role-key-not-real";
  it("trusted only for generate-design-gpt + service-role bearer + known channel", () => {
    expect(resolveTrustedSocialSketch("generate-design-gpt", "messenger", `Bearer ${KEY}`, KEY)).toBe("messenger");
    expect(resolveTrustedSocialSketch("generate-design-gpt", "instagram", `Bearer ${KEY}`, KEY)).toBe("instagram");
    // website calls: no channel, anon key, a user JWT, no header
    expect(resolveTrustedSocialSketch("generate-design-gpt", undefined, `Bearer ${KEY}`, KEY)).toBeNull();
    expect(resolveTrustedSocialSketch("generate-design-gpt", "messenger", "Bearer anon-key", KEY)).toBeNull();
    expect(resolveTrustedSocialSketch("generate-design-gpt", "messenger", "Bearer eyJ.user.jwt", KEY)).toBeNull();
    expect(resolveTrustedSocialSketch("generate-design-gpt", "messenger", null, KEY)).toBeNull();
    expect(resolveTrustedSocialSketch("generate-design-gpt", "messenger", `Bearer ${KEY}`, "")).toBeNull();
    // every other billable action stays gated, even with the service role
    for (const a of ["generate-design", "restyle-gpt", "isolate-subject-gpt", "edit-image", "faq-chat"]) {
      expect(resolveTrustedSocialSketch(a, "messenger", `Bearer ${KEY}`, KEY)).toBeNull();
    }
    // faq-chat's own resolver is unchanged
    expect(resolveTrustedSocialChannel("generate-design-gpt", "messenger", `Bearer ${KEY}`, KEY)).toBeNull();
  });

  it("without the trusted channel the gate condition is exactly BILLABLE_ACTIONS.has(action)", () => {
    for (const billable of [true, false]) expect(billableGateApplies(billable, null)).toBe(billable);
    expect(billableGateApplies(true, "messenger")).toBe(false);
  });

  const SRC = readFileSync(path.join(ROOT, "supabase/functions/gemini-proxy/index.ts"), "utf8");
  it("index.ts: the gate reads the trusted channel derived from the request, once", () => {
    expect(SRC).toContain("if (billableGateApplies(BILLABLE_ACTIONS.has(action), socialSketchChannel)) {");
    expect(SRC.match(/socialSketchChannel = /g)).toHaveLength(1);
    expect(SRC).toContain("const socialSketchChannel = resolveTrustedSocialSketch(\n      action,\n      params?.channel,\n      req.headers.get(\"Authorization\"),\n      Deno.env.get(\"SUPABASE_SERVICE_ROLE_KEY\"),\n    );");
    // the old unconditional form is gone, and nothing else changed shape
    expect(SRC).not.toContain("if (BILLABLE_ACTIONS.has(action)) {");
    expect(SRC).toContain("if (action === \"generate-design-gpt\") {");
  });

  it("website calls: gate decision equals BILLABLE_ACTIONS.has(action) for every action and caller", () => {
    const billable = new Set(["generate-design", "virtual-tryon", "upscale", "isolate-subject", "restyle", "edit-image", "isolate-design", "edit-image-cutout", "isolate-subject-gpt", "restyle-gpt", "generate-design-gpt"]);
    const actions = [...billable, "faq-chat", "convert-bg-black", "randomize-prompt"];
    const callers: [unknown, string | null][] = [
      [undefined, null], [undefined, "Bearer anon-key"], [undefined, "Bearer eyJ.user.jwt"],
      ["messenger", "Bearer anon-key"], ["instagram", "Bearer eyJ.user.jwt"], ["messenger", null],
    ];
    for (const a of actions) {
      for (const [channel, auth] of callers) {
        const trusted = resolveTrustedSocialSketch(a, channel, auth, KEY);
        expect(billableGateApplies(billable.has(a), trusted)).toBe(billable.has(a));
      }
    }
  });
});
