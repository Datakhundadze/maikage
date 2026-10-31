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
  planSketches,
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
  BACK_DRAWING_FACTOR,
  LARGE_TEXT_FACTOR,
  SKETCH_MARKER,
  SKETCH_NOTICE,
  TESTER_CAPS,
  designCacheKey,
  scaleBox,
  sketchBoxes,
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
  trimTransparent,
  tintLuminance,
  type FontLike,
  type PathCommand,
} from "../../supabase/functions/meta-webhook/sketchRaster";
import { FONT_SHA256, FONT_URLS, _resetSketchFont, loadSketchFont, sha256Hex } from "../../supabase/functions/meta-webhook/sketchFont";
import {
  DESIGN_LINK_LINE,
  SKETCH_ECHO_MS,
  buildHistory,
  cleanBotReply,
  decideAutoReply,
  humanTookOver,
  isBotEcho,
  sendImageBody,
  type BotSendRecord,
  type ThreadRow,
} from "../../supabase/functions/meta-webhook/botReply";
import { DEBOUNCE_MS, PHOTO_MIRROR_WAIT_MS, _resetTokenWarning, runAutoReply, type AutoReplyDeps, type TriggerRow } from "../../supabase/functions/meta-webhook/autoReply";
import {
  billableGateApplies,
  resolveTrustedSocialChannel,
  resolveTrustedSocialSketch,
  socialPromptBlock,
} from "../../supabase/functions/gemini-proxy/socialChannel";
import { buildHistoryWithPhotos, photoTag, stripSketchSystemText } from "../../supabase/functions/meta-webhook/botReply";
import {
  MAX_SKETCHES_PER_REPLY,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_SIDE,
  PIXEL_BUDGET_MS,
  preparePhoto,
} from "../../supabase/functions/meta-webhook/sketchFlow";
import { downscaleBy, keyOutWhite } from "../../supabase/functions/meta-webhook/sketchRaster";
import { parseChatSuggestion } from "@/lib/generateSuggestion";

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

  it("skips unplaceable photo mockups, edits, placeholders and order status", () => {
    // (2026-10-31) a photo in the chat no longer blocks a lettering sketch; a
    // photo block whose photo is not in storage is unsupported (link line)
    expect(planSketch(MOCK({ text: "გიორგი" }), true)?.kind).toBe("text");
    expect(planSketch(MOCK({ color: "Black" }), true)).toEqual({ kind: "unsupported", reason: "photo_unavailable" });
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

  it("generate: text + notice first, then the image — no follow-up text", async () => {
    // a real PNG so the decoder runs end to end
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    const s = sketchFakes({ generateDesign: async (_c, _k, p) => { s.calls.push(`generate:${String(p.style)}`); return pngBytes; } });
    const a = autoDeps(GEN({ prompt: "ლომი", style: "Anime", product: "GILDAN", color: "Black" }), s.deps);
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.sent).toEqual([`აი იდეა!\n${SKETCH_NOTICE}`]);
    expect(a.sent[0]).not.toContain(DESIGN_LINK_LINE);
    expect(s.calls).toContain("generate:ანიმე");
    expect(s.calls).toContain("fetch:https://maika.ge/products/tshirt/gildan-white-front.png");
    expect(s.calls.some((c) => c.startsWith("jpeg:1024x"))).toBe(true);
    expect(s.calls.find((c) => c.startsWith("upload:"))).toMatch(/^upload:social-sketches\/h{32}\/\d+\.jpg$/);
    expect(a.records.map((r) => r.kind)).toEqual(["reply", "sketch"]);
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

  it("customer photo not in our storage → link line, nothing rendered (after one mirror wait)", async () => {
    const s = sketchFakes();
    const a = autoDeps(MOCK({ photo: 1, color: "Black" }), s.deps, {
      loadThread: async () => [row({ meta_message_id: "m1", text: "ეს ფოტო დაადე", attachments: [{ type: "image", url: "u" }], sent_at: trigger.sent_at })],
    });
    await runAutoReply(trigger, a.deps);
    expect(a.sleeps).toEqual([DEBOUNCE_MS, PHOTO_MIRROR_WAIT_MS]);
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

// ── 2026-10-31 owner test: two sides at once, no follow-up, clean history ──

describe("two sides in one reply", () => {
  beforeEach(() => _resetTokenWarning());
  const TWO = `ზურგზე დროშა, წინ წარწერა.\n\`\`\`maika-generate\n${JSON.stringify({ prompt: "საქართველოს დროშა", style: "Illustration", side: "back", color: "White" })}\n\`\`\`\n\`\`\`maika-mockup\n${JSON.stringify({ text: "საქართველო", side: "front", placement: "left-chest", color: "White" })}\n\`\`\``;

  it("planSketches: one plan per block, in order, one per side, max 2", () => {
    const plans = planSketches(TWO, false);
    expect(plans.map((p) => p.kind)).toEqual(["generate", "text"]);
    expect(plans.map((p) => (p.kind === "unsupported" ? null : p.target.side))).toEqual(["back", "front"]);
    expect(planSketches("ფასი 25 ლარია", false)).toEqual([]);
    const sameSide = `${GEN({ prompt: "კატა", side: "front" })}\n${MOCK({ text: "ანა ბ", side: "front" })}`;
    expect(planSketches(sameSide, false)).toHaveLength(1);
    expect(planSketches(`${TWO}\n${MOCK({ text: "x y", side: "front" })}`, false, 1)).toHaveLength(1);
  });

  it("runAutoReply: one notice, then an image per side, nothing after", async () => {
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    const s = sketchFakes({ generateDesign: async () => pngBytes });
    const a = autoDeps(TWO, s.deps);
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(a.sent).toEqual([`ზურგზე დროშა, წინ წარწერა.\n${SKETCH_NOTICE}`]);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(2);
    expect(a.records.map((r) => r.kind)).toEqual(["reply", "sketch", "sketch"]);
  });

  it("caps count this reply's sketches too", async () => {
    const s = sketchFakes({ countSketches: async () => ({ generate: 0, text: MAX_TEXT_SKETCHES - 1 }) });
    const two = `${MOCK({ text: "ანა ბ", side: "front" })}\n${MOCK({ text: "ნიკა გ", side: "back" })}`;
    const a = autoDeps(two, s.deps);
    await runAutoReply(trigger, a.deps);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
  });

  it("a failed second sketch still sends the link line only once", async () => {
    let n = 0;
    const s = sketchFakes({ sendImage: async () => ({ ok: false, status: 400, code: "100" }), upload: async (p) => { n++; return `https://x/${p}`; } });
    const two = `${MOCK({ text: "ანა ბ", side: "front" })}\n${MOCK({ text: "ნიკა გ", side: "back" })}`;
    const a = autoDeps(two, s.deps);
    await runAutoReply(trigger, a.deps);
    expect(n).toBe(2);
    expect(a.sent.filter((t) => t === DESIGN_LINK_LINE)).toHaveLength(1);
  });
});

describe("sketch system lines never reach the model or the customer twice", () => {
  it("history: our sketch notice, old follow-up and image-only echoes are dropped", () => {
    const h = buildHistory([
      row({ meta_message_id: "a", text: "ზურგზე დროშა", sent_at: "2026-10-31T17:28:16Z" }),
      row({ meta_message_id: "b", direction: "out", text: `ჯერ ზურგზე დაგიხატავთ.\n${SKETCH_NOTICE}`, sent_at: "2026-10-31T17:28:38Z" }),
      row({ meta_message_id: "c", direction: "out", text: null, attachments: [{ type: "image", url: "https://x/y.jpg" }] as ThreadRow["attachments"], sent_at: "2026-10-31T17:29:00Z" }),
      row({ meta_message_id: "d", direction: "out", text: "ესკიზი 👆 შესაცვლელად ან შესაკვეთად მოგვწერეთ.", sent_at: "2026-10-31T17:29:02Z" }),
      row({ meta_message_id: "e", text: "წინაც", sent_at: "2026-10-31T17:29:16Z" }),
    ]);
    expect(h).toEqual([
      { role: "user", content: "ზურგზე დროშა" },
      { role: "assistant", content: "ჯერ ზურგზე დაგიხატავთ." },
      { role: "user", content: "წინაც" },
    ]);
  });

  it("cleanBotReply strips a copied notice / [ფოტო] / follow-up from the model", () => {
    const raw = `ახლა წინ დავამატებ.\n\n${SKETCH_NOTICE}[ფოტო]ესკიზი 👆 შესაცვლელად ან შესაკვეთად მოგვწერეთ.`;
    expect(cleanBotReply(raw)).toBe("ახლა წინ დავამატებ.");
  });
});

describe("trimTransparent", () => {
  it("crops GPT's transparent padding (with a small margin)", () => {
    const img = createImage(100, 100);
    for (let y = 40; y < 60; y++) for (let x = 30; x < 50; x++) img.data[(y * 100 + x) * 4 + 3] = 255;
    const t = trimTransparent(img, 8, 0);
    expect([t.width, t.height]).toEqual([20, 20]);
    expect(t.data[3]).toBe(255);
    expect(trimTransparent(createImage(10, 10)).width).toBe(10);
  });
});

describe("KB: flags print flat", () => {
  it("flag / emblem with no style → Illustration, flat, no pole", () => {
    const src = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");
    expect(src).toContain("FLAGS & EMBLEMS");
    expect(src).toContain("ბრტყელი ვექტორული, ბოძის გარეშე");
    const dm = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/socialChannel.ts"), "utf8");
    expect(dm).toContain("emit BOTH blocks in the SAME reply");
  });
});

// ── 2026-10-31 owner test 2: size, cache, tester caps, flat flags, prices ──

describe("sketch size", () => {
  it("size large parses on both blocks; junk ignored", () => {
    expect(parseGenerateBlock(GEN({ prompt: "x", size: "large" }))?.size).toBe("large");
    expect(parseMockupBlock(MOCK({ text: "ab", size: "BIG" }))?.size).toBe("large");
    expect(parseMockupBlock(MOCK({ text: "ab", size: "huge!" }))?.size).toBeUndefined();
  });

  it("back drawing is BACK_DRAWING_FACTOR bigger, large text LARGE_TEXT_FACTOR, inside the image", () => {
    const back = planSketch(GEN({ prompt: "დროშა", side: "back", product: "Hoodie", color: "Black" }), false) as SketchContext["plan"];
    const front = planSketch(GEN({ prompt: "დროშა", side: "front", product: "Hoodie", color: "Black" }), false) as SketchContext["plan"];
    const img = findProductImage(back.target)!;
    const b = sketchBoxes(back, img, 1000, 1000)[0];
    const f = sketchBoxes(front, findProductImage(front.target)!, 1000, 1000)[0];
    expect(b.w / f.w).toBeCloseTo(BACK_DRAWING_FACTOR, 2);
    const t = planSketch(MOCK({ text: "საქართველო" }), false) as SketchContext["plan"];
    const tl = planSketch(MOCK({ text: "საქართველო", size: "large" }), false) as SketchContext["plan"];
    const ti = findProductImage(t.target)!;
    expect(sketchBoxes(tl, ti, 1000, 1000)[0].w / sketchBoxes(t, ti, 1000, 1000)[0].w).toBeCloseTo(LARGE_TEXT_FACTOR, 2);
    const big = scaleBox({ x: 0, y: 0, w: 900, h: 900 }, 2, 1000, 1000);
    expect(big.x).toBeGreaterThanOrEqual(0);
    expect(big.x + big.w).toBeLessThanOrEqual(1000);
  });
});

describe("generated-design cache", () => {
  beforeEach(() => _resetTokenWarning());
  const hash = async (x: string) => x.length.toString(16).padStart(64, "0") + x.slice(0, 8);

  it("size / side change keeps the key; prompt or colour change does not", async () => {
    const k = (o: Record<string, unknown>) => designCacheKey(planSketch(GEN({ prompt: "დროშა", ...o }), false) as Extract<SketchContext["plan"], { kind: "generate" }>, async (x) => sha256Hex(x));
    expect(await k({ size: "large" })).toBe(await k({}));
    expect(await k({ side: "back" })).toBe(await k({ side: "front" }));
    expect(await k({ prompt: "ლომი" })).not.toBe(await k({}));
    expect(await k({ color: "Black" })).not.toBe(await k({ color: "White" }));
  });

  it("cache hit: no generation call, counted as a mockup, allowed past the generate cap", async () => {
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    let generated = 0;
    const s = sketchFakes({
      countSketches: async () => ({ generate: 3, text: 0 }),
      generateDesign: async () => { generated++; return pngBytes; },
      hashKey: hash,
      cacheGet: async () => pngBytes,
      cachePut: async () => {},
    });
    const a = autoDeps(GEN({ prompt: "დროშა", size: "large" }), s.deps);
    await runAutoReply(trigger, a.deps);
    expect(generated).toBe(0);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
    expect(a.records.find((r) => r.kind === "sketch")?.text).toBe(SKETCH_MARKER.text);
  });

  it("cache miss: generates once and stores the PNG", async () => {
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    const put: string[] = [];
    const s = sketchFakes({ generateDesign: async () => pngBytes, hashKey: hash, cacheGet: async () => null, cachePut: async (k) => { put.push(k); } });
    const a = autoDeps(GEN({ prompt: "დროშა" }), s.deps);
    await runAutoReply(trigger, a.deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(put).toHaveLength(1);
  });
});

describe("tester caps", () => {
  beforeEach(() => _resetTokenWarning());
  it("an allow-listed conversation gets TESTER_CAPS, others the normal 3", async () => {
    expect(withinCaps("generate", { generate: 3, text: 0 })).toBe(false);
    expect(withinCaps("generate", { generate: 3, text: 0 }, TESTER_CAPS)).toBe(true);
    const pngBytes = pngOf(2, 2, 6, 8, [[255, 0, 0, 255, 0, 0, 0, 0], [0, 0, 0, 0, 255, 0, 0, 255]]);
    const s = sketchFakes({ countSketches: async () => ({ generate: 3, text: 0 }), generateDesign: async () => pngBytes });
    const key = "messenger:159657880717306:psid1";
    const a = autoDeps(GEN({ prompt: "ლომი" }), s.deps, { loadSettings: async () => ({ enabled: true, schedule: "sunday", allowKeys: [key] }) });
    await runAutoReply(trigger, a.deps);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
  });
});

describe("DM text fixes", () => {
  it("[maika.ge/chat](https://maika.ge/chat) → the bare URL", () => {
    expect(cleanBotReply("ნახეთ: [maika.ge/chat](https://maika.ge/chat)")).toBe("ნახეთ: https://maika.ge/chat");
  });
  it("DM prompt: size, one font, one price line, own photo wording", () => {
    const dm = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/socialChannel.ts"), "utf8");
    expect(dm).toContain('\\"size\\":\\"large\\"');
    expect(dm).toContain("ONE font");
    expect(dm).toContain("NEVER list other models");
    expect(dm).toContain("Never say sending or uploading photos is impossible");
  });
});

describe("flags: magenta key instead of GPT transparency", () => {
  it("flag blocks get opaque params on magenta; other drawings unchanged", async () => {
    const { isFlagBlock, buildFlagGenerateParams, GUARD_FLAG_ON_KEY } = await import("../../supabase/functions/meta-webhook/sketchParse");
    const flag = planSketch(GEN({ prompt: "საქართველოს დროშა" }), false) as Extract<SketchContext["plan"], { kind: "generate" }>;
    const lion = planSketch(GEN({ prompt: "ლომი" }), false) as Extract<SketchContext["plan"], { kind: "generate" }>;
    expect(isFlagBlock(flag.block)).toBe(true);
    expect(isFlagBlock(lion.block)).toBe(false);
    const p = buildFlagGenerateParams(flag.block, flag.target);
    expect(p.transparent).toBe(false);
    expect(String(p.character)).toContain(GUARD_FLAG_ON_KEY);
    expect(await designCacheKey(flag, sha256Hex)).not.toBe(await designCacheKey(lion, sha256Hex));
  });

  it("keyOutColor clears magenta, keeps white and red opaque", async () => {
    const { keyOutColor } = await import("../../supabase/functions/meta-webhook/sketchRaster");
    const img = createImage(3, 1);
    img.data.set([255, 0, 255, 255, 255, 255, 255, 255, 220, 10, 20, 255]);
    keyOutColor(img, "#FF00FF");
    expect([img.data[3], img.data[7], img.data[11]]).toEqual([0, 255, 255]);
  });
});

// ── 2026-10-31: one sketch per customer photo ──────────────────────────────

/** A stored customer image attachment (url carries a token, like Meta's CDN). */
const storedImg = (n: string) => ({ type: "image", url: `https://cdn.example/${n}.jpg?oh=SECRET`, path: `messenger/2026-10/${n}-0.jpg`, stored: true });
/** w×h PNG: `inner` colour inside a 1-px border of `border` colour (RGBA). */
function framedPng(w: number, h: number, border: number[], inner: number[]): Uint8Array {
  const rows: number[][] = [];
  for (let y = 0; y < h; y++) {
    const r: number[] = [];
    for (let x = 0; x < w; x++) r.push(...(x === 0 || y === 0 || x === w - 1 || y === h - 1 ? border : inner));
    rows.push(r);
  }
  return pngOf(w, h, 6, 8, rows);
}
const RED_ON_WHITE = framedPng(6, 6, [255, 255, 255, 255], [255, 0, 0, 255]);
const PHOTOS = (n: number) => ({ paths: Array.from({ length: n }, (_, i) => `messenger/2026-10/p${i + 1}-0.jpg`), pending: Array.from({ length: n }, (_, i) => i + 1) });
const blocks = (...os: Record<string, unknown>[]) => `აი ესკიზები.\n${os.map((o) => `\`\`\`maika-mockup\n${JSON.stringify(o)}\n\`\`\``).join("\n")}`;

describe("photo numbering in the history", () => {
  it("[ფოტო N] in arrival order across the window, one per image; paths only for stored images; our images excluded", () => {
    const h = buildHistoryWithPhotos([
      row({ meta_message_id: "a", attachments: [storedImg("a")] as ThreadRow["attachments"], sent_at: "2026-11-01T07:00:00Z" }),
      row({ meta_message_id: "b", direction: "out", text: "რომელ პროდუქტზე?", attachments: [{ type: "image", url: "https://x/sk.jpg" }] as ThreadRow["attachments"], sent_at: "2026-11-01T07:01:00Z" }),
      row({ meta_message_id: "c", text: "ესენი", attachments: [storedImg("c1"), { type: "image", url: "u" }, storedImg("c3")] as ThreadRow["attachments"], sent_at: "2026-11-01T07:02:00Z" }),
      row({ meta_message_id: "d", attachments: [{ type: "image", url: null, purged: true }, { type: "audio", url: "a" }] as ThreadRow["attachments"], sent_at: "2026-11-01T07:03:00Z" }),
    ]);
    expect(h.turns).toEqual([
      { role: "user", content: "[ფოტო 1]" },
      { role: "assistant", content: "რომელ პროდუქტზე?" },
      { role: "user", content: "ესენი [ფოტო 2] [ფოტო 3] [ფოტო 4]" },
      { role: "user", content: "[ფოტო 5]" },
    ]);
    expect(h.photos.paths).toEqual(["messenger/2026-10/a-0.jpg", "messenger/2026-10/c1-0.jpg", null, "messenger/2026-10/c3-0.jpg", null]);
    // the burst after our last message
    expect(h.photos.pending).toEqual([2, 3, 4, 5]);
    expect(photoTag(7)).toBe("[ფოტო 7]");
  });

  it("a long text never loses its tags; the model's copied tags are stripped", () => {
    const h = buildHistoryWithPhotos([row({ meta_message_id: "a", text: "ა".repeat(1500), attachments: [storedImg("a")] as ThreadRow["attachments"], sent_at: "1" })]);
    expect(h.turns[0].content.endsWith(" [ფოტო 1]")).toBe(true);
    expect(h.turns[0].content.length).toBeLessThanOrEqual(1000);
    expect(stripSketchSystemText("კარგი [ფოტო 2] და [ფოტო] ✓")).toBe("კარგი  და  ✓");
    expect(cleanBotReply("ფასი 25₾ [ფოტო 3]")).toBe("ფასი 25₾");
  });
});

describe("photo blocks: parsing and plans", () => {
  it('"photo" parses as an integer 1..20; junk dropped', () => {
    expect(parseMockupBlock(MOCK({ photo: 2 }))?.photo).toBe(2);
    expect(parseMockupBlock(MOCK({ photo: " 3 " }))?.photo).toBe(3);
    for (const bad of [0, 21, 1.5, "x", -1, null, true]) expect(parseMockupBlock(MOCK({ photo: bad }))?.photo).toBeUndefined();
  });

  it("the website ignores the field (parser and chat suggestion unchanged)", () => {
    const withPhoto = MOCK({ photo: 1, product: "Hoodie", color: "Black", side: "back" });
    const without = MOCK({ product: "Hoodie", color: "Black", side: "back" });
    expect(parseMockupSuggestion(withPhoto)).toEqual(parseMockupSuggestion(without));
    expect(parseMockupSuggestion(withPhoto)).not.toHaveProperty("photo");
    expect(parseChatSuggestion(withPhoto, true)).toEqual(parseChatSuggestion(without, true));
  });

  it("one plan per photo, each on its own product / colour / side", () => {
    const plans = planSketches(blocks(
      { photo: 1, product: "T-Shirt", subProduct: "GILDAN", color: "White", side: "front" },
      { photo: 2, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" },
      { photo: 3, product: "Tote Bag", color: "Black" },
    ), PHOTOS(3), MAX_SKETCHES_PER_REPLY);
    expect(plans.map((p) => p.kind)).toEqual(["photo", "photo", "photo"]);
    expect(plans.map((p) => (p.kind === "photo" ? [p.block.photo, p.path, p.target.product, p.target.color, p.target.side] : null))).toEqual([
      [1, "messenger/2026-10/p1-0.jpg", "T-Shirt", "White", "front"],
      [2, "messenger/2026-10/p2-0.jpg", "Hoodie", "Black", "back"],
      [3, "messenger/2026-10/p3-0.jpg", "Tote Bag", "Black", "front"],
    ]);
  });

  it("dedupe by (photo, side); drawing / lettering keep one per side; at most 5", () => {
    const dup = planSketches(blocks({ photo: 1, side: "front" }, { photo: 1, side: "front", color: "Black" }, { photo: 1, side: "back" }, { photo: 2, side: "front" }), PHOTOS(2), 5);
    expect(dup.map((p) => (p.kind === "photo" ? `${p.block.photo}:${p.target.side}` : p.kind))).toEqual(["1:front", "1:back", "2:front"]);
    // a lettering block on the front next to a photo on the front: both go
    const mixed = planSketches(blocks({ photo: 1, side: "front" }, { text: "ანა ბ", side: "front" }, { text: "ნიკა გ", side: "front" }), PHOTOS(1), 5);
    expect(mixed.map((p) => p.kind)).toEqual(["photo", "text"]);
    const six = planSketches(blocks(...[1, 2, 3, 4, 5, 6].map((photo) => ({ photo }))), PHOTOS(6), MAX_SKETCHES_PER_REPLY);
    expect(MAX_SKETCHES_PER_REPLY).toBe(5);
    expect(six).toHaveLength(5);
  });

  it("invalid N → unsupported; AI edits stay unsupported; removeWhite is a photo plan", () => {
    const refs = { paths: ["messenger/2026-10/p1-0.jpg", null], pending: [1, 2] };
    expect(planSketch(MOCK({ photo: 3 }), refs)).toEqual({ kind: "unsupported", reason: "photo_unknown" });
    expect(planSketch(MOCK({ photo: 2 }), refs)).toEqual({ kind: "unsupported", reason: "photo_unavailable" });
    expect(planSketch(MOCK({ photo: 1, removeBackground: true }), refs)).toEqual({ kind: "unsupported", reason: "photo_edit" });
    expect(planSketch(MOCK({ photo: 1, editPrompt: "სათვალე დაადე" }), refs)).toEqual({ kind: "unsupported", reason: "photo_edit" });
    const rw = planSketch(MOCK({ photo: 1, removeWhite: true, color: "Black" }), refs);
    expect(rw?.kind === "photo" && rw.block.removeWhite).toBe(true);
    // no photos in the window at all
    expect(planSketch(MOCK({ photo: 1 }), false)).toEqual({ kind: "unsupported", reason: "photo_unknown" });
  });

  it('no "photo" and no "text": the burst\'s ONE photo is meant; with two it is not guessed', () => {
    const one = planSketch(MOCK({ color: "Black" }), { paths: ["old.jpg", "new.jpg"], pending: [2] });
    expect(one?.kind === "photo" && [one.block.photo, one.path]).toEqual([2, "new.jpg"]);
    expect(planSketch(MOCK({ color: "Black" }), PHOTOS(2))).toEqual({ kind: "unsupported", reason: "no_text" });
  });
});

describe("photo rendering", () => {
  it("downscale to ≤ PHOTO_MAX_SIDE in one pass; oversize refused", () => {
    const big = createImage(2500, 10);
    big.data.fill(255);
    expect(Math.max(preparePhoto(big).width, preparePhoto(big).height)).toBeLessThanOrEqual(PHOTO_MAX_SIDE);
    const half = downscaleBy({ width: 4, height: 2, data: Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 255, 9, 9, 9, 255, 0, 0, 0, 255, 255, 255, 255, 255, 9, 9, 9, 255, 9, 9, 9, 255]) }, 2);
    expect([half.width, half.height]).toEqual([2, 1]);
    expect(Array.from(half.data)).toEqual([128, 128, 128, 255, 9, 9, 9, 255]);
    expect(() => preparePhoto({ width: 5000, height: 5000, data: new Uint8ClampedArray(4) })).toThrow();
    expect(PHOTO_MAX_PIXELS).toBeLessThan(5000 * 5000);
  });

  it("removeWhite: near-white → transparent with a soft edge, colours kept; without it nothing is removed", async () => {
    const img = createImage(4, 1);
    img.data.set([255, 255, 255, 255, 240, 240, 240, 255, 215, 215, 215, 255, 180, 180, 180, 255]);
    keyOutWhite(img);
    expect([img.data[3], img.data[7], img.data[15]]).toEqual([0, 0, 255]);
    expect(img.data[11]).toBeGreaterThan(0);
    expect(img.data[11]).toBeLessThan(255);

    const photo = await decodePng(RED_ON_WHITE);
    const plain = preparePhoto({ ...photo, data: new Uint8ClampedArray(photo.data) });
    expect([plain.width, plain.height]).toEqual([6, 6]); // white kept, even for a dark garment
    expect(plain.data[3]).toBe(255);
    const keyed = preparePhoto({ ...photo, data: new Uint8ClampedArray(photo.data) }, { removeWhite: true });
    expect([keyed.width, keyed.height]).toEqual([4, 4]); // white border gone, then trimmed
    expect(Array.from(keyed.data.slice(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it("the photo lands in the drawing box on the product (private download, contain-fit)", async () => {
    const canvases: { width: number; height: number; data: Uint8ClampedArray }[] = [];
    const downloads: string[] = [];
    const s = sketchFakes({
      downloadUpload: async (p) => { downloads.push(p); return framedPng(6, 6, [255, 0, 0, 255], [255, 0, 0, 255]); },
      encodeJpeg: (img) => { canvases.push(img); return new Uint8Array([1]); },
    });
    const plan = planSketch(MOCK({ photo: 1, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" }), PHOTOS(1)) as SketchContext["plan"];
    const base: SketchBaseDeps = { now: () => SUNDAY_NOON, recordSend: async () => "r", markSent: async () => {}, send: async () => ({ ok: true }), log: () => {} };
    expect(await runSketch({ channel: "messenger", conversationKey: "k", customerId: "c", plan, budgetMs: 30_000 }, base, s.deps)).toBe("sent");
    expect(downloads).toEqual(["messenger/2026-10/p1-0.jpg"]);
    const c = canvases[0];
    const box = sketchBoxes(plan, findProductImage(plan.target)!, c.width, c.height)[0];
    const at = (x: number, y: number) => Array.from(c.data.slice((Math.round(y) * c.width + Math.round(x)) * 4, (Math.round(y) * c.width + Math.round(x)) * 4 + 3));
    expect(at(box.x + box.w / 2, box.y + box.h / 2)).toEqual([255, 0, 0]);
    expect(at(2, 2)).not.toEqual([255, 0, 0]); // outside the box: the garment
    // a back photo is placed like a back drawing (BACK_DRAWING_FACTOR)
    const front = planSketch(MOCK({ photo: 1, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "front" }), PHOTOS(1)) as SketchContext["plan"];
    const fb = sketchBoxes(front, findProductImage(front.target)!, 1000, 1000)[0];
    const bb = sketchBoxes(plan, findProductImage(plan.target)!, 1000, 1000)[0];
    expect(bb.w / fb.w).toBeCloseTo(BACK_DRAWING_FACTOR, 2);
  });

  it("no download dep / failed download → link line, reason logged without the path", async () => {
    const logs: string[] = [];
    const sent: string[] = [];
    const base: SketchBaseDeps = { now: () => SUNDAY_NOON, recordSend: async () => "r", markSent: async () => {}, send: async (_c, _t, text) => { sent.push(text); return { ok: true }; }, log: (_l, m) => { logs.push(m); } };
    const plan = planSketch(MOCK({ photo: 1 }), PHOTOS(1)) as SketchContext["plan"];
    expect(await runSketch({ channel: "messenger", conversationKey: "k", customerId: "c", plan, budgetMs: 30_000 }, base, sketchFakes().deps)).toBe("photo_download_unavailable");
    expect(await runSketch({ channel: "messenger", conversationKey: "k", customerId: "c", plan, budgetMs: 30_000 }, base, sketchFakes({ downloadUpload: async () => null }).deps)).toBe("photo_download");
    expect(sent).toEqual([DESIGN_LINK_LINE, DESIGN_LINK_LINE]);
    expect(logs.join(" ")).not.toContain("messenger/2026-10");
  });
});

describe("runAutoReply with customer photos", () => {
  beforeEach(() => _resetTokenWarning());
  const photoThread = (n: number) => [row({
    meta_message_id: "m1", text: "ეს თეთრ მაისურზე წინ, ის შავ ჰუდიზე ზურგზე",
    attachments: Array.from({ length: n }, (_, i) => storedImg(`p${i + 1}`)) as ThreadRow["attachments"], sent_at: trigger.sent_at,
  })];

  it("no canned acknowledgement: the AI sees the numbered photos and every block becomes one image", async () => {
    let history: string[] = [];
    const downloads: string[] = [];
    const logs: string[] = [];
    const s = sketchFakes({ downloadUpload: async (p) => { downloads.push(p); return RED_ON_WHITE; } });
    const raw = blocks(
      { photo: 1, product: "T-Shirt", subProduct: "GILDAN", color: "White", side: "front" },
      { photo: 2, product: "Hoodie", subProduct: "GILDAN Hoodie", color: "Black", side: "back" },
    );
    const a = autoDeps(raw, s.deps, {
      loadThread: async () => photoThread(2),
      askBot: async (_c, _k, h) => { history = h.map((t) => t.content); return raw; },
      log: (_l, m) => { logs.push(m); },
    });
    expect(await runAutoReply(trigger, a.deps)).toBe("reply");
    expect(history).toEqual(["ეს თეთრ მაისურზე წინ, ის შავ ჰუდიზე ზურგზე [ფოტო 1] [ფოტო 2]"]);
    expect(a.sent).toEqual([`აი ესკიზები.\n${SKETCH_NOTICE}`]);
    expect(downloads).toEqual(["messenger/2026-10/p1-0.jpg", "messenger/2026-10/p2-0.jpg"]);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(2);
    expect(s.calls.filter((c) => c.startsWith("upload:")).every((c) => /^upload:social-sketches\/h{32}\/\d+\.jpg$/.test(c))).toBe(true);
    expect(a.records.map((r) => [r.kind, r.text])).toEqual([["reply", `აი ესკიზები.\n${SKETCH_NOTICE}`], ["sketch", SKETCH_MARKER.photo], ["sketch", SKETCH_MARKER.photo]]);
    expect(a.records.some((r) => r.kind === "photo")).toBe(false);
    expect(a.sleeps).toEqual([DEBOUNCE_MS]); // already stored → no mirror wait
    expect(logs.join(" ")).not.toMatch(/SECRET|messenger\/2026-10/);
  });

  it("the same product photo is decoded once per reply", async () => {
    const s = sketchFakes({ downloadUpload: async () => RED_ON_WHITE });
    const a = autoDeps(blocks({ photo: 1 }, { photo: 2 }, { photo: 3 }), s.deps, { loadThread: async () => photoThread(3) });
    await runAutoReply(trigger, a.deps);
    expect(s.calls.filter((c) => c.startsWith("fetch:"))).toHaveLength(1);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(3);
  });

  it("photos count toward the mockup cap; a capped / unplaceable one adds the link line once, after the images", async () => {
    expect(countSketchRows([{ text: SKETCH_MARKER.photo }, { text: SKETCH_MARKER.text }, { text: SKETCH_MARKER.generate }])).toEqual({ generate: 1, text: 2 });
    const s = sketchFakes({ countSketches: async () => ({ generate: 0, text: MAX_TEXT_SKETCHES - 1 }), downloadUpload: async () => RED_ON_WHITE });
    const a = autoDeps(blocks({ photo: 1 }, { photo: 2 }, { photo: 9 }), s.deps, { loadThread: async () => photoThread(2) });
    await runAutoReply(trigger, a.deps);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
    expect(a.sent).toEqual([`აი ესკიზები.\n${SKETCH_NOTICE}`, DESIGN_LINK_LINE]);
  });

  it("pixel budget: once PIXEL_BUDGET_MS is spent, the rest get the link line once", async () => {
    let clock = SUNDAY_NOON.getTime();
    const logs: string[] = [];
    const s = sketchFakes({
      downloadUpload: async () => RED_ON_WHITE,
      encodeJpeg: () => { clock += Math.ceil(PIXEL_BUDGET_MS * 0.6); return new Uint8Array([1]); },
    });
    const a = autoDeps(blocks({ photo: 1 }, { photo: 2 }, { photo: 3 }, { photo: 4 }), s.deps, {
      loadThread: async () => photoThread(4),
      now: () => new Date(clock),
      log: (_l, m) => { logs.push(m); },
    });
    await runAutoReply(trigger, a.deps);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(2);
    expect(a.sent.filter((t) => t === DESIGN_LINK_LINE)).toHaveLength(1);
    expect(logs.some((l) => l.includes("cpu_budget"))).toBe(true);
  });

  it("a photo still being copied: one PHOTO_MIRROR_WAIT_MS wait, then the stored copy is used", async () => {
    let reads = 0;
    const s = sketchFakes({ downloadUpload: async () => RED_ON_WHITE });
    const fresh = [row({ meta_message_id: "m1", text: "შავ მაისურზე", attachments: [{ type: "image", url: "https://cdn.example/x?oh=SECRET" }], sent_at: trigger.sent_at })];
    const a = autoDeps(blocks({ photo: 1, color: "Black" }), s.deps, { loadThread: async () => (++reads === 1 ? fresh : photoThread(1)) });
    await runAutoReply(trigger, a.deps);
    expect(a.sleeps).toEqual([DEBOUNCE_MS, PHOTO_MIRROR_WAIT_MS]);
    expect(reads).toBe(2);
    expect(s.calls.filter((c) => c.startsWith("image:"))).toHaveLength(1);
  });
});

describe("DM prompt: customer photos", () => {
  it("numbered photos, one block per photo, ask when the product is missing, prices per product", () => {
    const dm = socialPromptBlock("messenger", "sunday");
    expect(dm).toContain("„[ფოტო 1]\", „[ფოტო 2]\"");
    expect(dm).toContain("emit ONE maika-mockup block with \"photo\": N");
    expect(dm).toContain("{\"photo\":2,\"product\":\"Hoodie\",\"subProduct\":\"GILDAN Hoodie\",\"color\":\"Black\",\"side\":\"back\"}");
    expect(dm).toContain("Several photos → several blocks in the SAME reply");
    expect(dm).toContain("ask ONE short question");
    expect(dm).toContain("one line per product they named (two-sided → that model + 10/15");
    expect(dm).toContain("Never say sending or uploading photos is impossible");
    expect(dm).not.toContain("an operator will send the sketch");
    // the example blocks in the prompt are themselves valid photo blocks
    const plans = planSketches(dm, PHOTOS(2), MAX_SKETCHES_PER_REPLY);
    expect(plans.map((p) => p.kind)).toEqual(["photo", "photo"]);
  });
});
