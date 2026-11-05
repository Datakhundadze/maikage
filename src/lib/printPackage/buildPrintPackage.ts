// Admin "საბეჭდი პაკეტი": one ZIP per order (cart) with
//   - maika-<order>.pdf  — job sheet: sketch + product, model, colour, size,
//                           quantity, sides, print size in cm, texts, notes;
//   - <n>-<side>.png     — print file per item side: transparent, trimmed to
//                           the design, at its real size and 300 DPI.
//
// Built entirely in the admin's browser: no edge function, no storage write,
// no SQL. It READS the order (design_state, mockups, originals) and reuses the
// existing compositePrintFileFromDesignState unchanged — photo background
// handling happens by handing that compositor substituted photo URLs.

import { zip, type Zippable } from "fflate";
import type { DesignState, DesignStateSide } from "@/lib/designState";
import { getDesignStateTexts, isDesignState } from "@/lib/designState";
import { compositePrintFileFromDesignState } from "@/lib/designCompositor";
import { supabase } from "@/integrations/supabase/client";
import { COLORS } from "@/lib/catalog";
import { removeSolidBackground } from "./solidBackground";
import { hasPhysicalSizeRule, isKidsGarment, physicalSizeForItem, PRINT_DPI, type PhysicalSize } from "./printSize";
import { setPngDpi } from "./pngDpi";
import { buildJpegPdf, type PdfJpegPage } from "./simplePdf";

export interface PackageOrderRow {
  id: string;
  cart_id: string | null;
  first_name: string;
  last_name: string;
  product: string;
  sub_product: string | null;
  color: string | null;
  size: string | null;
  prompt: string | null;
  comment: string | null;
  is_studio: boolean;
  created_at: string;
  delivery_type: string;
  /** Contact + courier data for the job sheet. Optional so older callers compile. */
  phone?: string | null;
  email?: string | null;
  delivery_address?: string | null;
  front_mockup_url: string | null;
  back_mockup_url: string | null;
  transparent_image_url: string | null;
  back_transparent_image_url: string | null;
  design_state: DesignState | null;
}

export interface PackageUnit {
  row: PackageOrderRow;
  count: number;
}

export type Side = "front" | "back";
export type PhotoBgMode = "original" | "auto" | "ai";

/** Per-photo background decision, keyed by the photo's original URL (the same
 *  photo in several units of one cart — e.g. two sizes — shares one decision). */
export interface PhotoChoice {
  mode: PhotoBgMode;
  /** Object/data URL of the auto-cleaned image (when detection found a solid background). */
  autoUrl?: string;
  autoColor?: string | null;
  /** Data URL of the AI cut-out. */
  aiUrl?: string;
}

// ─── image helpers ──────────────────────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`სურათი ვერ ჩაიტვირთა: ${url.slice(0, 80)}`));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas → blob failed"))), type, quality),
  );
}

const MAX_PHOTO_SIDE = 3000;

/** Draw an image into a canvas, capped at MAX_PHOTO_SIDE on its longer side. */
function imageToCanvas(img: HTMLImageElement, maxSide = MAX_PHOTO_SIDE): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/**
 * Detect and remove a solid border background. Returns an object URL of the
 * cleaned PNG, or null when the photo has no solid background (or is already
 * transparent).
 */
export async function autoCleanPhoto(url: string): Promise<{ url: string; color: string | null } | null> {
  const img = await loadImage(url);
  const c = imageToCanvas(img);
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const res = removeSolidBackground(data.data, c.width, c.height);
  if (!res.removed) return null;
  ctx.putImageData(data, 0, 0);
  const blob = await canvasToBlob(c, "image/png");
  return { url: URL.createObjectURL(blob), color: res.color };
}

/** AI background removal with the existing gemini-proxy GPT action (one paid call). */
export async function aiCleanPhoto(url: string): Promise<string> {
  const img = await loadImage(url);
  const c = imageToCanvas(img, 2048);
  let dataUrl = c.toDataURL("image/png");
  if (dataUrl.length > 11_000_000) dataUrl = c.toDataURL("image/jpeg", 0.92);
  const { data, error } = await supabase.functions.invoke("gemini-proxy", {
    body: { action: "isolate-subject-gpt", params: { image: dataUrl } },
  });
  if (error) {
    let msg = error.message;
    try {
      const b = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (b?.error) msg = b.error;
    } catch {
      /* keep message */
    }
    throw new Error(msg);
  }
  const out = (data as { image?: string } | null)?.image;
  if (!out) throw new Error("AI-მ სურათი არ დააბრუნა");
  return out;
}

/** Tight bounding box of non-transparent pixels (alpha > 8). */
function alphaBBox(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (px[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d")!.drawImage(img, 0, 0);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ─── print file per side ────────────────────────────────────────────────────

export interface SidePrint {
  side: Side;
  png: Uint8Array;
  widthPx: number;
  heightPx: number;
  size: PhysicalSize | null;
  /** Notes for the job sheet (background handling, fallbacks). */
  notes: string[];
}

const BASE_CANVAS = 4000;
const MAX_CANVAS = 8000;

function withPhotoOverrides(side: DesignStateSide, choices: Record<string, PhotoChoice>) {
  const notes: string[] = [];
  const photos = side.photos.map((p, i) => {
    if (!p.url) return p;
    const ch = choices[p.url];
    if (!ch) return p;
    if (ch.mode === "ai" && ch.aiUrl) {
      notes.push(`ფოტო ${i + 1}: ფონი მოიხსნა AI-ით`);
      return { ...p, url: ch.aiUrl };
    }
    if (ch.mode === "auto" && ch.autoUrl) {
      notes.push(`ფოტო ${i + 1}: ერთფეროვანი ფონი მოიხსნა${ch.autoColor ? ` (${ch.autoColor})` : ""}`);
      return { ...p, url: ch.autoUrl };
    }
    if (ch.mode === "original") notes.push(`ფოტო ${i + 1}: ფონი დატოვებულია, როგორც ესკიზზეა`);
    return p;
  });
  return { side: { ...side, photos }, notes };
}

async function renderFromDesignState(
  row: PackageOrderRow,
  sideState: DesignStateSide,
  choices: Record<string, PhotoChoice>,
): Promise<SidePrint | null> {
  const { side, notes } = withPhotoOverrides(sideState, choices);
  const missing = side.photos.filter((p) => !p.url).length;
  if (missing) notes.push(`ყურადღება: ${missing} ფოტო შეკვეთაში ვერ აიტვირთა — ფაილში არ არის`);

  const base = await compositePrintFileFromDesignState(side, { canvasWidth: BASE_CANVAS });
  if (!base) return null;
  const baseCanvas = await blobToCanvas(base);
  const bbox = alphaBBox(baseCanvas);
  if (!bbox) return null;

  const zoneW = BASE_CANVAS * side.zone.width;
  const zoneH = BASE_CANVAS * side.zone.height;
  const size = hasPhysicalSizeRule(row.product)
    ? physicalSizeForItem(row.product, row.sub_product, bbox.w / zoneW, bbox.h / zoneH)
    : null;
  if (size && isKidsGarment(row.sub_product)) notes.push("საბავშვო — ზომა 85%-ზეა შემცირებული");

  const targetW = size ? size.widthPx : bbox.w;
  const targetH = size ? size.heightPx : bbox.h;

  // Re-render larger when the print needs more pixels than the 4000 canvas has.
  let src = baseCanvas;
  let k = 1;
  const want = targetW / bbox.w;
  if (want > 1.05) {
    const canvasW = Math.min(MAX_CANVAS, Math.ceil(BASE_CANVAS * want));
    const big = await compositePrintFileFromDesignState(side, { canvasWidth: canvasW });
    if (big) {
      src = await blobToCanvas(big);
      k = canvasW / BASE_CANVAS;
    }
  }

  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, bbox.x * k, bbox.y * k, bbox.w * k, bbox.h * k, 0, 0, targetW, targetH);
  const blob = await canvasToBlob(out, "image/png");
  let png: Uint8Array = new Uint8Array(await blob.arrayBuffer());
  if (size) png = setPngDpi(png, PRINT_DPI);
  else notes.push("ზომა სმ-ში ამ პროდუქტზე ავტომატურად არ ითვლება — შეამოწმეთ ხელით");
  return { side: side.side, png, widthPx: targetW, heightPx: targetH, size, notes };
}

/** Orders without design_state: trim the stored print file, keep its pixels. */
async function renderFromStoredFile(side: Side, url: string): Promise<SidePrint | null> {
  const img = await loadImage(url);
  const c = imageToCanvas(img, 100_000);
  const bbox = alphaBBox(c);
  if (!bbox) return null;
  const out = document.createElement("canvas");
  out.width = bbox.w;
  out.height = bbox.h;
  out.getContext("2d")!.drawImage(c, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  const png = new Uint8Array(await (await canvasToBlob(out, "image/png")).arrayBuffer());
  return {
    side, png, widthPx: bbox.w, heightPx: bbox.h, size: null,
    notes: ["შენახული პრინტ ფაილიდან (design_state არ აქვს) — ზომა შეამოწმეთ ხელით"],
  };
}

export async function renderSidePrint(
  row: PackageOrderRow,
  side: Side,
  choices: Record<string, PhotoChoice>,
): Promise<SidePrint | null> {
  const ds = isDesignState(row.design_state) ? row.design_state[side] : null;
  if (ds && (ds.photos.length || getDesignStateTexts(ds).length)) {
    return renderFromDesignState(row, ds, choices);
  }
  const stored = side === "front" ? row.transparent_image_url : row.back_transparent_image_url;
  return stored ? renderFromStoredFile(side, stored) : null;
}

export function unitSides(row: PackageOrderRow): Side[] {
  const out: Side[] = [];
  const ds = isDesignState(row.design_state) ? row.design_state : null;
  const has = (s: Side) => {
    const st = ds?.[s];
    if (st && (st.photos.length || getDesignStateTexts(st).length)) return true;
    return !!(s === "front" ? row.transparent_image_url : row.back_transparent_image_url);
  };
  if (has("front")) out.push("front");
  if (has("back")) out.push("back");
  return out;
}

// ─── job sheet ──────────────────────────────────────────────────────────────

const PRODUCT_LABELS: Record<string, string> = {
  "T-Shirt": "მაისური",
  Hoodie: "ჰუდი",
  "Tote Bag": "ჩანთა",
  Cap: "კეპი",
  Apron: "წინსაფარი",
  "Phone Case": "ტელეფონის ქეისი",
  Mug: "ჭიქა",
  Sport: "სპორტული ფორმა",
};

const DELIVERY_LABELS: Record<string, string> = {
  pickup: "მაღაზიიდან გატანა",
  courier_tbilisi: "კურიერი თბილისში",
  courier_outside: "კურიერი რეგიონში",
};

const SIDE_LABEL: Record<Side, string> = { front: "წინა", back: "უკანა" };

const PAGE_W = 1654; // A4 at 200 DPI
const PAGE_H = 2339;
const FONT = "'Noto Sans Georgian', 'BPG Arial', sans-serif";

async function ensureSheetFonts() {
  try {
    await document.fonts.load(`28px "Noto Sans Georgian"`, "ა");
    await document.fonts.load(`bold 28px "Noto Sans Georgian"`, "ა");
  } catch {
    /* system fallback */
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export function orderNumber(rows: PackageOrderRow[]): string {
  return (rows[0].cart_id || rows[0].id).slice(0, 8).toUpperCase();
}

interface SheetContact {
  phone: string | null;
  address: string | null;
}

/** First non-empty phone / courier address across the cart's rows. */
export function sheetContact(rows: PackageOrderRow[]): SheetContact {
  const pick = (f: (r: PackageOrderRow) => string | null | undefined) =>
    rows.map(f).find((v) => typeof v === "string" && v.trim().length > 0)?.trim() ?? null;
  return { phone: pick((r) => r.phone), address: pick((r) => r.delivery_address) };
}

interface SheetUnit {
  unit: PackageUnit;
  index: number;
  total: number;
  prints: SidePrint[];
}

async function drawSheetPage(head: PackageOrderRow, contact: SheetContact, su: SheetUnit): Promise<PdfJpegPage> {
  const c = document.createElement("canvas");
  c.width = PAGE_W;
  c.height = PAGE_H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const M = 90;
  let y = M;
  const row = su.unit.row;

  // Header
  ctx.fillStyle = "#111111";
  ctx.font = `bold 52px ${FONT}`;
  ctx.textBaseline = "top";
  ctx.fillText(`შეკვეთა #${orderNumber([head])}`, M, y);
  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = "#555555";
  const dateStr = new Date(head.created_at).toLocaleString("ka-GE", { dateStyle: "medium", timeStyle: "short" });
  ctx.textAlign = "right";
  ctx.fillText("maika.ge", PAGE_W - M, y + 6);
  ctx.fillText(dateStr, PAGE_W - M, y + 46);
  ctx.textAlign = "left";
  y += 72;
  // Customer: name + phone, then delivery (+ courier address). Row 0 of a cart
  // carries the delivery data, so the caller passes `head` = first unit's row;
  // fall back across units for phone/address (sheetContact).
  ctx.font = `bold 34px ${FONT}`;
  ctx.fillStyle = "#111111";
  const phone = contact.phone ? `  ·  ტელ: ${contact.phone}` : "";
  ctx.fillText(`${head.first_name} ${head.last_name}${phone}`, M, y);
  y += 50;
  ctx.font = `30px ${FONT}`;
  ctx.fillStyle = "#333333";
  const deliveryLabel = DELIVERY_LABELS[head.delivery_type] ?? head.delivery_type;
  const isCourier = head.delivery_type !== "pickup";
  const deliveryLine = isCourier && contact.address ? `${deliveryLabel}: ${contact.address}` : deliveryLabel;
  for (const l of wrapLines(ctx, deliveryLine, PAGE_W - 2 * M).slice(0, 3)) {
    ctx.fillText(l, M, y);
    y += 42;
  }
  if (isCourier && !contact.address) {
    ctx.fillStyle = "#b45309";
    ctx.fillText("მისამართი შეკვეთაში არ არის — დაუკავშირდით კლიენტს", M, y);
    y += 42;
  }
  y += 14;
  ctx.fillStyle = "#e5e5e5";
  ctx.fillRect(M, y, PAGE_W - 2 * M, 3);
  y += 30;

  // Item title
  ctx.fillStyle = "#111111";
  ctx.font = `bold 44px ${FONT}`;
  const itemTitle = su.total > 1 ? `ნივთი ${su.index + 1} / ${su.total}` : "ნივთი";
  ctx.fillText(`${itemTitle}  ·  ${su.unit.count} ცალი`, M, y);
  y += 72;

  // Sketch (mockups)
  const mockups = ([
    ["front", row.front_mockup_url],
    ["back", row.back_mockup_url],
  ] as const).filter(([, u]) => !!u);
  if (mockups.length) {
    const gap = 40;
    const boxW = mockups.length === 1 ? 900 : (PAGE_W - 2 * M - gap) / 2;
    const boxH = 900;
    let x = mockups.length === 1 ? (PAGE_W - boxW) / 2 : M;
    for (const [side, url] of mockups) {
      try {
        const img = await loadImage(url!);
        const s = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
        const w = img.naturalWidth * s, h = img.naturalHeight * s;
        ctx.drawImage(img, x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
      } catch {
        ctx.fillStyle = "#f2f2f2";
        ctx.fillRect(x, y, boxW, boxH);
      }
      ctx.fillStyle = "#555555";
      ctx.font = `30px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(`${SIDE_LABEL[side]} მხარე`, x + boxW / 2, y + boxH + 10);
      ctx.textAlign = "left";
      x += boxW + gap;
    }
    y += boxH + 70;
  }

  // Details table
  const sides = su.prints.map((p) => SIDE_LABEL[p.side]).join(" + ") || "—";
  const details: [string, string][] = [
    ["პროდუქტი", PRODUCT_LABELS[row.product] ?? row.product],
    ["მოდელი / ხარისხი", row.sub_product || "—"],
    ["ფერი", row.color || "—"],
    [row.product === "Phone Case" ? "ტელეფონის მოდელი" : "ზომა", row.size || "არ არის არჩეული"],
    ["რაოდენობა", `${su.unit.count}`],
    ["ბეჭდვა", sides],
  ];
  for (const p of su.prints) {
    const sz = p.size ? `${p.size.widthCm} × ${p.size.heightCm} სმ (სიგანე × სიმაღლე)` : "ზომა ხელით";
    details.push([`${SIDE_LABEL[p.side]} პრინტი`, sz]);
  }
  const back = isDesignState(row.design_state) ? row.design_state.back : null;
  if (back?.printSize) details.push(["უკანა — გადახდილი ზომა", back.printSize === "small" ? "პატარა" : "დიდი"]);

  const labelW = 470;
  for (const [k, v] of details) {
    ctx.font = `30px ${FONT}`;
    ctx.fillStyle = "#666666";
    ctx.fillText(k, M, y);
    ctx.font = `bold 34px ${FONT}`;
    ctx.fillStyle = "#111111";
    ctx.fillText(v, M + labelW, y - 2);
    y += 54;
  }

  // Texts
  const ds = isDesignState(row.design_state) ? row.design_state : null;
  const texts = (["front", "back"] as const).flatMap((s) =>
    ds?.[s] ? getDesignStateTexts(ds[s]!).map((t) => ({ s, t })) : [],
  );
  const notes = su.prints.flatMap((p) => p.notes.map((n) => `${SIDE_LABEL[p.side]}: ${n}`));
  const freeText: string[] = [];
  if (!texts.length && row.prompt && !row.is_studio) freeText.push(`წარწერა: ${row.prompt}`);
  if (row.comment) freeText.push(`კომენტარი: ${row.comment}`);

  const block = (title: string, lines: string[]) => {
    if (!lines.length || y > PAGE_H - M - 60) return;
    y += 20;
    ctx.font = `bold 32px ${FONT}`;
    ctx.fillStyle = "#111111";
    ctx.fillText(title, M, y);
    y += 50;
    ctx.font = `28px ${FONT}`;
    ctx.fillStyle = "#222222";
    for (const l of lines) {
      for (const w of wrapLines(ctx, l, PAGE_W - 2 * M)) {
        if (y > PAGE_H - M - 40) return;
        ctx.fillText(w, M, y);
        y += 42;
      }
    }
  };
  block(
    "ტექსტები",
    texts.map(({ s, t }) => `${SIDE_LABEL[s]}: „${t.content.replace(/\n/g, " / ")}“ — ${t.fontName}, ${t.color}`),
  );
  block("შენიშვნები", [...notes, ...freeText]);

  // Footer: file names
  ctx.font = `24px ${FONT}`;
  ctx.fillStyle = "#888888";
  const files = su.prints.map((p) => printFileName(su.index, su.total, p.side)).join("   ");
  ctx.fillText(`ფაილები: ${files}`, M, PAGE_H - M);

  const jpegBlob = await canvasToBlob(c, "image/jpeg", 0.88);
  return { jpeg: new Uint8Array(await jpegBlob.arrayBuffer()), width: PAGE_W, height: PAGE_H };
}

/**
 * Download name = the customer's first + last name (David 2026-11-05).
 * Characters that are illegal in file names are dropped; an empty name falls
 * back to the order number. Same name twice → the browser adds " (1)".
 */
export function packageBaseName(head: Pick<PackageOrderRow, "first_name" | "last_name">, orderNum: string): string {
  const name = `${head.first_name ?? ""} ${head.last_name ?? ""}`
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || `maika-${orderNum}`;
}

export function printFileName(index: number, total: number, side: Side): string {
  return `${total > 1 ? `item${index + 1}-` : ""}${side}.png`;
}

// ─── package ────────────────────────────────────────────────────────────────

export interface BuildResult {
  fileName: string;
  sides: number;
}

export async function buildPrintPackage(
  units: PackageUnit[],
  choices: Record<string, PhotoChoice>,
  onProgress?: (msg: string) => void,
): Promise<BuildResult> {
  if (!units.length) throw new Error("შეკვეთაში ნივთი არ არის");
  await ensureSheetFonts();
  const head = units[0].row;
  const contact = sheetContact(units.map((u) => u.row));
  const num = orderNumber(units.map((u) => u.row));
  const files: Zippable = {};
  const pages: PdfJpegPage[] = [];
  let sides = 0;

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const prints: SidePrint[] = [];
    for (const side of unitSides(u.row)) {
      onProgress?.(`ნივთი ${i + 1}: ${SIDE_LABEL[side]} მხარე…`);
      const p = await renderSidePrint(u.row, side, choices);
      if (!p) continue;
      prints.push(p);
      files[printFileName(i, units.length, side)] = [p.png, { level: 0 }];
      sides++;
    }
    onProgress?.(`ნივთი ${i + 1}: ფურცელი…`);
    pages.push(await drawSheetPage(head, contact, { unit: u, index: i, total: units.length, prints }));
  }

  const baseName = packageBaseName(head, num);
  files[`${baseName}.pdf`] = [buildJpegPdf(pages), { level: 6 }];
  const zipped = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (err, data) => (err ? reject(err) : resolve(data))),
  );
  const fileName = `${baseName}.zip`;
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return { fileName, sides };
}

/** Every distinct photo (original URL) used in the package, in order, with the
 *  garment colours it is printed on. */
export function packagePhotos(units: PackageUnit[]): { url: string; label: string; garmentColors: string[] }[] {
  const byUrl = new Map<string, { url: string; label: string; garmentColors: string[] }>();
  units.forEach((u, ui) => {
    const ds = isDesignState(u.row.design_state) ? u.row.design_state : null;
    for (const s of ["front", "back"] as const) {
      ds?.[s]?.photos.forEach((p, pi) => {
        if (!p.url) return;
        const e = byUrl.get(p.url);
        if (e) {
          if (u.row.color && !e.garmentColors.includes(u.row.color)) e.garmentColors.push(u.row.color);
          return;
        }
        byUrl.set(p.url, {
          url: p.url,
          label: `${units.length > 1 ? `ნივთი ${ui + 1} · ` : ""}${SIDE_LABEL[s]} · ფოტო ${pi + 1}`,
          garmentColors: u.row.color ? [u.row.color] : [],
        });
      });
    }
  });
  return [...byUrl.values()];
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * True when removing a background of `bgHex` changes nothing visible on every
 * garment the photo is printed on (white box on a white shirt). Only then is
 * the automatic removal the DEFAULT: on a contrasting garment the box is part
 * of what the customer saw on the sketch (a QR code's white field on a black
 * shirt), so the admin decides. Unknown colour names → false.
 */
export function backgroundMatchesGarment(bgHex: string | null | undefined, garmentColors: string[]): boolean {
  const bg = bgHex ? hexToRgb(bgHex) : null;
  if (!bg || garmentColors.length === 0) return false;
  return garmentColors.every((name) => {
    const hex = COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase())?.hex;
    const g = hex ? hexToRgb(hex) : null;
    if (!g) return false;
    const d = Math.hypot(bg[0] - g[0], bg[1] - g[1], bg[2] - g[2]);
    return d <= 60;
  });
}
