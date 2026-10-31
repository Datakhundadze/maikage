// DM sketch — block parsing and generation params (pure: no Deno, no I/O).
//
// faq-chat replies can carry a fenced ```maika-generate or ```maika-mockup
// block. On the website src/lib/generateSuggestion.ts and mockupSuggestion.ts
// parse it and SimplePage turns it into a sketch. The edge function cannot
// import from src/ (Lovable deploys only the function folder), so this file is
// a port of exactly the parts the DM sketch needs, reading the catalog from
// catalogSnapshot.ts:
//
//   parseGenerateBlock  ← parseGenerateSuggestion (no brand aliases, as there)
//   parseMockupBlock    ← parseMockupSuggestion   (brand aliases, placeholders)
//   resolveGarmentColor ← mockupSuggestion.resolveGarmentColor + nearestColor
//   buildGenerateParams ← SimplePage.handleAiGenerate + runGenerationPipeline:
//                         the three guards, the slogan from quotes, the style
//                         label and the realistic style override
//
// Where the site falls back to the customer's current constructor selection
// (sessionStorage), a DM has none: the site's defaults stand in — T-Shirt,
// that product's first brand (GILDAN), White, front.
//
// MUST RUN ON THE RAW REPLY, before cleanBotReply strips the fences.

import {
  COLORS,
  ENTRIES,
  MAX_SEED_PROMPT_LENGTH,
  MAX_SEED_TEXT_LENGTH,
  PRODUCT_TYPES,
  STYLE_OPTIONS,
  SUB_PRODUCTS,
  TEXT_COLORS,
} from "./catalogSnapshot.ts";

const norm = (s: string) => s.trim().toLowerCase();

export const DEFAULT_PRODUCT = "T-Shirt";
export const DEFAULT_COLOR = "White";

// ── catalog lookups (snapshot) ─────────────────────────────────────────────

export function subProductsOf(type: string): string[] {
  return SUB_PRODUCTS[type] ?? [];
}

/** catalog.getDefaultSubProduct: the first brand, or the type itself. */
export function defaultSubProduct(type: string): string {
  const subs = subProductsOf(type);
  return subs.length > 0 ? subs[0] : type;
}

/** catalog.getAvailableColors: colours with an entry, in entry order. */
export function availableColors(type: string, sub?: string): string[] {
  const s = sub || (subProductsOf(type)[0] ?? type);
  const out: string[] = [];
  for (const e of ENTRIES) if (e.type === type && e.sub === s && !out.includes(e.color)) out.push(e.color);
  return out;
}

function resolveProductType(raw: string): string | null {
  return PRODUCT_TYPES.find((p) => norm(p) === norm(raw)) ?? null;
}

const BRAND_ALIASES: Record<string, string> = {
  "gildan hammer": "GILDAN HUMMER",
  "hammer": "GILDAN HUMMER",
  "hummer": "GILDAN HUMMER",
};
const unalias = (raw: string) => BRAND_ALIASES[norm(raw).replace(/\s+/g, " ")] ?? raw;

function resolveBrand(raw: string, aliases: boolean): { product: string; subProduct: string } | null {
  const name = aliases ? unalias(raw) : raw;
  for (const p of PRODUCT_TYPES) {
    const hit = subProductsOf(p).find((s) => norm(s) === norm(name));
    if (hit) return { product: p, subProduct: hit };
  }
  return null;
}

// ── nearest colour (port of src/lib/nearestColor.ts) ───────────────────────

function words(name: string): string[] {
  return norm(name).split(/[^a-z0-9]+/).filter(Boolean);
}
function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function resolveNearestColor(
  requested: string,
  available: readonly string[],
  palette: readonly { name: string; hex: string }[],
): string | null {
  const want = norm(requested);
  if (!want || available.length === 0) return null;
  const exact = available.find((a) => norm(a) === want);
  if (exact) return exact;
  const wantWords = new Set(words(requested));
  const family = available.filter((a) => words(a).some((w) => wantWords.has(w)));
  if (family.length === 0) return null;
  if (family.length === 1) return family[0];
  const wantHex = palette.find((c) => norm(c.name) === want)?.hex;
  const wantRgb = wantHex ? rgb(wantHex) : null;
  if (!wantRgb) return family[0];
  let best = family[0];
  let bestD = Infinity;
  for (const name of family) {
    const hex = palette.find((c) => norm(c.name) === norm(name))?.hex;
    const c = hex ? rgb(hex) : null;
    if (!c) continue;
    const d = Math.hypot(wantRgb[0] - c[0], wantRgb[1] - c[1], wantRgb[2] - c[2]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

export function resolveGarmentColor(requested: string, product: string, subProduct: string): string | null {
  const available = availableColors(product, subProduct);
  const canonical = COLORS.find((c) => norm(c.name) === norm(requested))?.name;
  return resolveNearestColor(canonical ?? requested, available, COLORS);
}

// ── style ──────────────────────────────────────────────────────────────────

function styleIndex(raw: unknown): number {
  if (typeof raw !== "string") return -1;
  const n = norm(raw);
  if (!n) return -1;
  const en = STYLE_OPTIONS.en.findIndex((s) => norm(s) === n);
  if (en >= 0) return en;
  return STYLE_OPTIONS.ge.findIndex((s) => norm(s) === n);
}
/** generateSuggestion.canonicalStyle: the English label, or "" (Auto). */
export function canonicalStyle(raw: unknown): string {
  const i = styleIndex(raw);
  return i >= 0 ? STYLE_OPTIONS.en[i] : "";
}
/**
 * generateSuggestion.styleForLang(canonical, "ge"): the label the Georgian
 * site's style chip holds — what handleAiGenerate passes as `style`.
 */
export function siteStyleLabel(canonical: unknown): string {
  const i = styleIndex(canonical);
  return i >= 0 ? STYLE_OPTIONS.ge[i] : "";
}

// ── blocks ─────────────────────────────────────────────────────────────────

export type Placement = "center" | "small" | "left-chest" | "right-chest" | "jersey-back";

export interface GenerateBlock {
  prompt: string;
  style: string;
  withBackground: boolean;
  product?: string;
  subProduct?: string;
  color?: string;
  side?: "front" | "back";
  placement?: Exclude<Placement, "jersey-back">;
  /** DM only: „უფრო დიდი" → "large". The site ignores the field. */
  size?: "large";
}

export interface MockupBlock {
  text?: string;
  product?: string;
  subProduct?: string;
  color?: string;
  side?: "front" | "back";
  placement?: Placement;
  number?: string;
  textColor?: string;
  removeBackground?: boolean;
  editPrompt?: string;
  removeWhite?: boolean;
  /** DM only: „უფრო დიდი" → "large". The site ignores the field. */
  size?: "large";
  /**
   * DM only: which customer photo („[ფოტო N]" in the history, 1-based) this
   * block places. The site's parser builds its result field by field and
   * never reads it.
   */
  photo?: number;
}

/** Highest „[ფოტო N]" a block may name (the history holds 8 messages). */
export const MAX_PHOTO_NUMBER = 20;

const truthy = (v: unknown) => v === true || (typeof v === "string" && norm(v) === "true");

/** Product / brand / colour / side, exactly as both site parsers resolve them. */
function resolveProductFields(
  parsed: Record<string, unknown>,
  out: { product?: string; subProduct?: string; color?: string; side?: "front" | "back" },
  aliases: boolean,
): void {
  if (typeof parsed.product === "string") {
    const asType = resolveProductType(parsed.product);
    if (asType) out.product = asType;
    else {
      const asBrand = resolveBrand(parsed.product, aliases);
      if (asBrand) {
        out.product = asBrand.product;
        out.subProduct = asBrand.subProduct;
      }
    }
  }
  if (typeof parsed.subProduct === "string") {
    const base = out.product ?? DEFAULT_PRODUCT;
    const wanted = aliases ? unalias(parsed.subProduct) : parsed.subProduct;
    const hit = subProductsOf(base).find((s) => norm(s) === norm(wanted));
    if (hit) {
      out.subProduct = hit;
      if (!out.product) out.product = base;
    } else {
      const asBrand = resolveBrand(parsed.subProduct, aliases);
      if (asBrand && !out.product) {
        out.product = asBrand.product;
        out.subProduct = asBrand.subProduct;
      }
    }
  }
  if (typeof parsed.color === "string") {
    const base = out.product ?? DEFAULT_PRODUCT;
    const sub = out.subProduct ?? defaultSubProduct(base);
    const resolved = resolveGarmentColor(parsed.color, base, sub);
    if (resolved) out.color = resolved;
  }
  if (typeof parsed.side === "string") {
    const s = norm(parsed.side);
    if (s === "front" || s === "back") out.side = s;
  }
}

function blockJson(raw: string, kind: "generate" | "mockup"): Record<string, unknown> | null {
  const re = kind === "generate" ? /```maika-generate\s*([\s\S]*?)```/ : /```maika-mockup\s*([\s\S]*?)```/;
  const match = raw.match(re); // closed fence only, like the site
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseGenerateBlock(raw: string): GenerateBlock | null {
  const parsed = blockJson(raw, "generate");
  if (!parsed) return null;
  const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim().slice(0, MAX_SEED_PROMPT_LENGTH) : "";
  if (!prompt) return null;
  const out: GenerateBlock = {
    prompt,
    style: canonicalStyle(parsed.style),
    withBackground: truthy(parsed.withBackground),
  };
  resolveProductFields(parsed, out, false);
  if (typeof parsed.placement === "string") {
    const pl = norm(parsed.placement);
    if (pl === "center" || pl === "small" || pl === "left-chest" || pl === "right-chest") out.placement = pl;
  }
  if (typeof parsed.size === "string" && /^(large|big|xl)$/i.test(parsed.size.trim())) out.size = "large";
  return out;
}

export const PLACEHOLDER_TEXTS = new Set([
  "თქვენი ტექსტი", "თქვენი ტექსტი აქ", "your text", "your text here", "text", "ტექსტი", "...", "…",
  "გვარი", "სახელი", "სახელი გვარი",
]);
function isPlaceholderText(t: string): boolean {
  if (PLACEHOLDER_TEXTS.has(norm(t))) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  const ws = tokens.filter((w) => !/^\d+$/.test(w));
  return ws.length > 0 && ws.length < tokens.length && PLACEHOLDER_TEXTS.has(norm(ws.join(" ")));
}

export function parseMockupBlock(raw: string): MockupBlock | null {
  const parsed = blockJson(raw, "mockup");
  if (!parsed) return null;
  const out: MockupBlock = {};
  if (typeof parsed.text === "string") {
    const t = parsed.text.trim();
    if (t && t.length <= MAX_SEED_TEXT_LENGTH && !isPlaceholderText(t)) out.text = t;
  }
  resolveProductFields(parsed, out, true);
  if (truthy(parsed.removeBackground)) out.removeBackground = true;
  if (truthy(parsed.removeWhite)) out.removeWhite = true;
  if (typeof parsed.editPrompt === "string" && parsed.editPrompt.trim()) {
    out.editPrompt = parsed.editPrompt.trim().slice(0, MAX_SEED_PROMPT_LENGTH);
  }
  if (typeof parsed.number === "string" || typeof parsed.number === "number") {
    const n = String(parsed.number).trim();
    if (/^\d{1,3}$/.test(n)) out.number = n;
  }
  if (typeof parsed.placement === "string") {
    const pl = norm(parsed.placement);
    if (pl === "center" || pl === "small" || pl === "left-chest" || pl === "right-chest" || pl === "jersey-back") out.placement = pl;
  }
  if (typeof parsed.textColor === "string") {
    const hit = resolveNearestColor(parsed.textColor, TEXT_COLORS.map((c) => c.name), TEXT_COLORS);
    if (hit) out.textColor = hit;
  }
  if (typeof parsed.size === "string" && /^(large|big|xl)$/i.test(parsed.size.trim())) out.size = "large";
  if (typeof parsed.photo === "number" || typeof parsed.photo === "string") {
    const raw = String(parsed.photo).trim();
    const n = /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PHOTO_NUMBER) out.photo = n;
  }
  return out;
}

// ── the plan for one bot reply ─────────────────────────────────────────────

export interface ProductChoice {
  product: string;
  subProduct: string;
  color: string;
  side: "front" | "back";
}

export type SketchPlan =
  | { kind: "generate"; block: GenerateBlock; target: ProductChoice }
  | { kind: "text"; block: MockupBlock & { text: string }; target: ProductChoice }
  /** The customer's own photo N, from the private social-uploads `path`. */
  | { kind: "photo"; block: MockupBlock & { photo: number }; target: ProductChoice; path: string }
  | { kind: "unsupported"; reason: string };

/** A plan that renders an image (everything but "unsupported"). */
export type RenderPlan = Exclude<SketchPlan, { kind: "unsupported" }>;

/**
 * The customer's photos the reply may place: paths[N - 1] = storage path of
 * „[ფოტო N]" (null = not stored), pending = the numbers of this burst.
 * (botReply.buildHistoryWithPhotos builds it; same shape as its PhotoRefs.)
 */
export interface SketchPhotos {
  paths: readonly (string | null)[];
  pending: readonly number[];
}
export const NO_PHOTOS: SketchPhotos = { paths: [], pending: [] };

/**
 * `true` / `false` are the pre-photo-sketch callers' "the customer sent a
 * photo" flag: true = one photo, not stored (so nothing can be placed).
 */
function photosOf(p: boolean | SketchPhotos | undefined): SketchPhotos {
  if (p === true) return { paths: [null], pending: [1] };
  if (!p) return NO_PHOTOS;
  return p;
}

/** Fill the gaps the way the site's seed does, with the site's defaults. */
export function productChoice(b: { product?: string; subProduct?: string; color?: string; side?: "front" | "back"; placement?: string }): ProductChoice {
  const product = b.product ?? DEFAULT_PRODUCT;
  const subProduct = b.subProduct ?? defaultSubProduct(product);
  const colors = availableColors(product, subProduct);
  const color = b.color && colors.includes(b.color)
    ? b.color
    : colors.includes(DEFAULT_COLOR) ? DEFAULT_COLOR : (colors[0] ?? DEFAULT_COLOR);
  const side = b.side ?? (b.placement === "jersey-back" ? "back" : "front");
  return { product, subProduct, color, side };
}

const ORDER_STATUS_RE = /```maika-order-status\b/;

/**
 * What sketch, if any, this RAW bot reply asks for. null = no design block at
 * all (cleanBotReply then adds no link either). Same precedence as the site's
 * parseChatSuggestion: order status wins, then generate, then mockup.
 *
 * PHOTOS (2026-10-31). A mockup with "photo": N places the customer's photo N
 * when it is in our storage ("photo" plan); unknown / unstored N →
 * "unsupported" (the link line). A mockup with neither "photo" nor "text"
 * while the burst holds exactly ONE photo means that photo (the site's habit:
 * a photo block has no text). "removeWhite" is done locally; the AI edits
 * ("removeBackground", "editPrompt") stay unsupported in v1.
 */
export function planSketch(raw: string, photos: boolean | SketchPhotos): SketchPlan | null {
  const s = String(raw ?? "");
  const hasGenerateFence = /```maika-generate\b/.test(s);
  const hasMockupFence = /```maika-mockup\b/.test(s);
  if (!hasGenerateFence && !hasMockupFence) return null;
  if (ORDER_STATUS_RE.test(s)) return { kind: "unsupported", reason: "order_status" };

  const g = parseGenerateBlock(s);
  if (g) return { kind: "generate", block: g, target: productChoice(g) };

  const m = parseMockupBlock(s);
  if (!m) return { kind: "unsupported", reason: "unparseable" };
  const refs = photosOf(photos);
  const n = m.photo ?? (!m.text && refs.pending.length === 1 ? refs.pending[0] : undefined);
  if (n !== undefined) {
    if (m.editPrompt || m.removeBackground) return { kind: "unsupported", reason: "photo_edit" };
    if (n > refs.paths.length) return { kind: "unsupported", reason: "photo_unknown" };
    const path = refs.paths[n - 1];
    if (!path) return { kind: "unsupported", reason: "photo_unavailable" };
    return { kind: "photo", block: { ...m, photo: n }, target: productChoice(m), path };
  }
  if (m.editPrompt || m.removeBackground || m.removeWhite) return { kind: "unsupported", reason: "photo_edit" };
  if (!m.text) return { kind: "unsupported", reason: "no_text" };
  return { kind: "text", block: { ...m, text: m.text }, target: productChoice(m) };
}

// ── generation params (SimplePage.handleAiGenerate, verbatim guards) ────────

export const GUARD_NO_GARMENT =
  "Output ONLY the standalone design artwork itself on a plain solid " +
  "white background. Do NOT draw or include any t-shirt, hoodie, garment, " +
  "apparel, clothing, fabric, mockup, folded shirt, hanger, or product of " +
  "any kind. No clothing item, no product photo, no shirt — just the " +
  "isolated graphic artwork, centered, ready to be printed.";

export const GUARD_ISOLATE_BG =
  "CRITICAL: render the subject as a SINGLE ISOLATED design element on a PLAIN " +
  "SOLID WHITE (#FFFFFF) background. Do NOT draw any scenery, environment, " +
  "landscape, room, sky, ground, floor, wall, building, rooftop, city, street " +
  "or any background setting — even if the description mentions a place or " +
  "location, treat it ONLY as theme/style inspiration, NEVER as a literal " +
  "background. No full-frame scene, no rectangular photo, no border. The " +
  "background must be empty pure white so the artwork can be cleanly cut out.";

export const GUARD_SLOGAN_NO_CARD =
  "Render any text as bold STANDALONE typography/lettering floating directly " +
  "on the plain background — NOT placed on a paper, card, poster, sign, banner, " +
  "sticker, label, note, frame, or any rectangular backdrop surface. No sheet " +
  "of paper, no card, no poster behind the text — just the letters as isolated " +
  "graphic artwork.";

/** runGenerationPipeline's realistic override of the style string. */
export const REALISTIC_STYLE_OVERRIDE =
  "realistic hyperrealistic photographic render — ultra-detailed surface textures, NO black outlines, smooth natural color gradients, photographic lighting and shadows, NOT illustration NOT drawing NOT cartoon NOT graphic art";

/** The quoted slogan, exactly as handleAiGenerate extracts it. */
export function extractSlogan(text: string): string {
  return text.match(/[«"„“”'`]([^«»"„“”'`]{2,120})[»"“”'`]/)?.[1]?.trim() ?? "";
}

export const isRealisticStyle = (style: string) => /realistic|photo|რეალ/i.test(style || "");

/**
 * The generate-design-gpt params the website sends for this block.
 *
 * Without background (the site's default): runGenerationPipeline →
 * tryGptGenerateDesign({...adjustedDesignParams, product, color, isRealistic}),
 * with GUARD_ISOLATE_BG appended and the realistic style override applied.
 *
 * With background the site calls Gemini generate-design (no isolate guard, no
 * style override, isRealistic as a flag). The DM sketch uses GPT for both, so
 * here the same fields go to generate-design-gpt with transparent: false.
 */
export function buildGenerateParams(g: GenerateBlock, target: ProductChoice): Record<string, unknown> {
  const text = g.prompt.trim();
  const slogan = extractSlogan(text);
  const aiStyle = siteStyleLabel(g.style);
  const isRealistic = isRealisticStyle(aiStyle);
  const characterWithGuard = `${text} ${GUARD_NO_GARMENT}${slogan ? ` ${GUARD_SLOGAN_NO_CARD}` : ""}`;
  const base = {
    scene: "",
    text: slogan,
    characterImages: [],
    sceneImage: null,
    styleImage: null,
    textImage: null,
    product: target.product,
    color: target.color,
    isRealistic,
  };
  if (!g.withBackground) {
    return {
      character: `${characterWithGuard} ${GUARD_ISOLATE_BG}`,
      style: isRealistic ? REALISTIC_STYLE_OVERRIDE : aiStyle,
      ...base,
    };
  }
  return { character: characterWithGuard, style: aiStyle, ...base, transparent: false };
}

// ── several sketches from one reply (add-only, 2026-10-31) ─────────────────

const ANY_FENCE_RE = /```maika-(generate|mockup)\s*[\s\S]*?```/g;

/**
 * Every design block in a RAW bot reply, in order, one plan each — so „წინ X,
 * უკან Y" gets both sketches in one go. One plan per side (the first block for
 * a side wins), at most `max`. [] = no design block. Unsupported plans stay in
 * the list so the caller can log them and add the link line.
 *
 * Photo plans (2026-10-31) are one per (photo, side) instead, on top of the
 * drawing / text rule: „this on the front, that one on the back of a hoodie"
 * → one sketch per photo.
 */
export function planSketches(raw: string, photos: boolean | SketchPhotos, max = 2): SketchPlan[] {
  const s = String(raw ?? "");
  if (!/```maika-(generate|mockup)\b/.test(s)) return [];
  if (ORDER_STATUS_RE.test(s)) return [{ kind: "unsupported", reason: "order_status" }];
  const fences = s.match(ANY_FENCE_RE) ?? [];
  if (fences.length === 0) return [{ kind: "unsupported", reason: "unparseable" }];
  const out: SketchPlan[] = [];
  const sides = new Set<string>();
  const photoSides = new Set<string>();
  for (const fence of fences) {
    if (out.length >= max) break;
    const plan = planSketch(fence, photos);
    if (!plan) continue;
    if (plan.kind === "photo") {
      const k = `${plan.block.photo}:${plan.target.side}`;
      if (photoSides.has(k)) continue;
      photoSides.add(k);
    } else if (plan.kind !== "unsupported") {
      if (sides.has(plan.target.side)) continue;
      sides.add(plan.target.side);
    }
    out.push(plan);
  }
  return out;
}

// ── flags: chroma-key instead of GPT transparency (add-only, 2026-10-31) ────
//
// GPT's transparent mode treats a flag's WHITE field as background (sim: the
// Georgian flag came back as red crosses only, even when told to keep whites
// opaque). For a flag / coat of arms the DM sketch therefore asks for an
// opaque image on a solid magenta key colour and cuts the magenta out itself
// (sketchRaster.keyOutColor). The site path is unchanged.

export const FLAG_PROMPT_RE = /დროშ|გერბ|ემბლემ|\bflags?\b|coat of arms|\bemblem/i;
export const KEY_COLOR_HEX = "#FF00FF";

export function isFlagBlock(g: GenerateBlock): boolean {
  return !g.withBackground && FLAG_PROMPT_RE.test(g.prompt);
}

export const GUARD_FLAG_ON_KEY =
  "Draw ONLY the flag / coat of arms itself, flat and straight on, large, centred, with its exact colours " +
  "and proportions — its white parts are solid opaque white. Everything around it is a SOLID, uniform PURE " +
  "MAGENTA (#FF00FF) background: no gradient, no shadow, no texture, no border, no pole. Magenta is a cut-out " +
  "key colour: never use magenta or pink inside the flag.";

export function buildFlagGenerateParams(g: GenerateBlock, target: ProductChoice): Record<string, unknown> {
  return {
    character: `${g.prompt.trim()}. ${GUARD_FLAG_ON_KEY}`,
    style: "flat vector graphic",
    scene: "",
    text: "",
    characterImages: [],
    sceneImage: null,
    styleImage: null,
    textImage: null,
    product: target.product,
    color: target.color,
    isRealistic: false,
    transparent: false,
  };
}
