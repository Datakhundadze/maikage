// DM sketch — pixel work on plain RGBA buffers (pure: no Deno, no I/O).
//
//   tintLuminance    ProductPreview.colorizeImage: luminance × target colour,
//                    fully transparent pixels skipped (the site's live preview)
//   resample         area-average when shrinking, bilinear when enlarging;
//                    premultiplied so transparent edges do not fringe
//   drawOver         source-over alpha compositing at a pixel offset
//   flattenOnWhite   product photos have a transparent background; JPEG has none
//   renderTextLines  glyph outlines (opentype.js-shaped font) → coverage mask
//                    → colour, contain-fitted into a box

import type { RgbaImage } from "./pngDecode.ts";
import { containFit, type Box } from "./sketchLayout.ts";

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

/** In place. Same formula as ProductPreview.colorizeImage / catalogCompositing.tintCanvas. */
export function tintLuminance(img: RgbaImage, hex: string): void {
  const [tr, tg, tb] = hexToRgb(hex);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const t = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    d[i] = Math.round(tr * t);
    d[i + 1] = Math.round(tg * t);
    d[i + 2] = Math.round(tb * t);
  }
}

/** Resize to dw×dh. */
export function resample(src: RgbaImage, dw: number, dh: number): RgbaImage {
  dw = Math.max(1, Math.round(dw));
  dh = Math.max(1, Math.round(dh));
  if (dw === src.width && dh === src.height) return { width: dw, height: dh, data: new Uint8ClampedArray(src.data) };
  return dw <= src.width && dh <= src.height ? areaAverage(src, dw, dh) : bilinear(src, dw, dh);
}

function areaAverage(src: RgbaImage, dw: number, dh: number): RgbaImage {
  const { width: sw, height: sh, data: s } = src;
  const out = createImage(dw, dh);
  const o = out.data;
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    const iy0 = Math.floor(y0), iy1 = Math.min(sh, Math.ceil(y1));
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      const ix0 = Math.floor(x0), ix1 = Math.min(sw, Math.ceil(x1));
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = ix0; sx < ix1; sx++) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const i = (sy * sw + sx) * 4;
          const al = s[i + 3] * w;
          r += s[i] * al; g += s[i + 1] * al; b += s[i + 2] * al; a += al; wsum += w;
        }
      }
      const j = (y * dw + x) * 4;
      if (a > 0) {
        o[j] = r / a; o[j + 1] = g / a; o[j + 2] = b / a;
      }
      o[j + 3] = wsum > 0 ? a / wsum : 0;
    }
  }
  return out;
}

function bilinear(src: RgbaImage, dw: number, dh: number): RgbaImage {
  const { width: sw, height: sh, data: s } = src;
  const out = createImage(dw, dh);
  const o = out.data;
  for (let y = 0; y < dh; y++) {
    const fy = Math.max(0, Math.min(sh - 1, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.max(0, Math.min(sw - 1, ((x + 0.5) * sw) / dw - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - tx) * (1 - ty) * s[i00 + 3], w10 = tx * (1 - ty) * s[i10 + 3];
      const w01 = (1 - tx) * ty * s[i01 + 3], w11 = tx * ty * s[i11 + 3];
      const a = w00 + w10 + w01 + w11;
      const j = (y * dw + x) * 4;
      if (a > 0) {
        o[j] = (s[i00] * w00 + s[i10] * w10 + s[i01] * w01 + s[i11] * w11) / a;
        o[j + 1] = (s[i00 + 1] * w00 + s[i10 + 1] * w10 + s[i01 + 1] * w01 + s[i11 + 1] * w11) / a;
        o[j + 2] = (s[i00 + 2] * w00 + s[i10 + 2] * w10 + s[i01 + 2] * w01 + s[i11 + 2] * w11) / a;
      }
      o[j + 3] = a;
    }
  }
  return out;
}

/** Source-over `src` onto `dst` with its top-left at (dx, dy), clipped. In place. */
export function drawOver(dst: RgbaImage, src: RgbaImage, dx: number, dy: number): void {
  dx = Math.round(dx);
  dy = Math.round(dy);
  const d = dst.data, s = src.data;
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const i = (y * src.width + x) * 4;
      const sa = s[i + 3] / 255;
      if (sa === 0) continue;
      const j = (ty * dst.width + tx) * 4;
      const da = d[j + 3] / 255;
      const oa = sa + da * (1 - sa);
      d[j] = (s[i] * sa + d[j] * da * (1 - sa)) / oa;
      d[j + 1] = (s[i + 1] * sa + d[j + 1] * da * (1 - sa)) / oa;
      d[j + 2] = (s[i + 2] * sa + d[j + 2] * da * (1 - sa)) / oa;
      d[j + 3] = oa * 255;
    }
  }
}

/** In place: every pixel opaque, transparency shown as white. */
export function flattenOnWhite(img: RgbaImage): void {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a === 1) continue;
    d[i] = d[i] * a + 255 * (1 - a);
    d[i + 1] = d[i + 1] * a + 255 * (1 - a);
    d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
}

/** Resize `design` to contain-fit `box` (centred) and draw it onto `dst`. */
export function drawContained(dst: RgbaImage, design: RgbaImage, box: Box): Box {
  const fit = containFit(box, design.width, design.height);
  if (fit.w < 1 || fit.h < 1) return fit;
  const scaled = resample(design, fit.w, fit.h);
  drawOver(dst, scaled, fit.x, fit.y);
  return fit;
}

// ── text ───────────────────────────────────────────────────────────────────

export type PathCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };

/** The part of an opentype.js Font the sketch uses. */
export interface FontLike {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  getPath(text: string, x: number, y: number, fontSize: number): { commands: PathCommand[] };
  getAdvanceWidth(text: string, fontSize: number): number;
}

/** Glyph outlines for the (multi-line) text, lines centred, baseline 0 for line 1. */
export function layoutText(font: FontLike, text: string, size: number): PathCommand[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const lineHeight = ((font.ascender - font.descender) / font.unitsPerEm) * size * 1.05;
  const widths = lines.map((l) => font.getAdvanceWidth(l, size));
  const maxW = Math.max(0, ...widths);
  const cmds: PathCommand[] = [];
  lines.forEach((l, i) => {
    const p = font.getPath(l, (maxW - widths[i]) / 2, i * lineHeight, size);
    for (const c of p.commands) cmds.push(c);
  });
  return cmds;
}

export function commandBounds(cmds: PathCommand[]): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const c of cmds) {
    if (c.type === "Z") continue;
    add(c.x, c.y);
    if (c.type === "Q" || c.type === "C") add(c.x1, c.y1);
    if (c.type === "C") add(c.x2, c.y2);
  }
  return Number.isFinite(x0) && x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Flatten outlines into closed polygons, transformed by scale s and offset (ox, oy). */
function flatten(cmds: PathCommand[], s: number, ox: number, oy: number): number[][] {
  const polys: number[][] = [];
  let cur: number[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const T = (x: number, y: number): [number, number] => [x * s + ox, y * s + oy];
  const push = (x: number, y: number) => { const [a, b] = T(x, y); cur.push(a, b); };
  const steps = (len: number) => Math.max(2, Math.min(32, Math.ceil(len * s / 3)));
  for (const c of cmds) {
    if (c.type === "M") {
      if (cur.length >= 6) polys.push(cur);
      cur = [];
      push(c.x, c.y);
      cx = sx = c.x; cy = sy = c.y;
    } else if (c.type === "L") {
      push(c.x, c.y); cx = c.x; cy = c.y;
    } else if (c.type === "Q") {
      const n = steps(Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        push(u * u * cx + 2 * u * t * c.x1 + t * t * c.x, u * u * cy + 2 * u * t * c.y1 + t * t * c.y);
      }
      cx = c.x; cy = c.y;
    } else if (c.type === "C") {
      const n = steps(Math.hypot(c.x1 - cx, c.y1 - cy) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let k = 1; k <= n; k++) {
        const t = k / n, u = 1 - t;
        push(
          u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        );
      }
      cx = c.x; cy = c.y;
    } else {
      cx = sx; cy = sy;
    }
  }
  if (cur.length >= 6) polys.push(cur);
  return polys;
}

const SUBSAMPLES = 4;

/**
 * Non-zero-winding scanline fill → coverage 0..1 per pixel of a w×h mask.
 * SUBSAMPLES sample rows per pixel row, exact horizontal span coverage.
 */
export function rasterizePolygons(polys: number[][], w: number, h: number): Float32Array {
  const cov = new Float32Array(w * h);
  type Edge = { x0: number; y0: number; x1: number; y1: number; dir: number };
  const edges: Edge[] = [];
  for (const p of polys) {
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = p[i * 2], ay = p[i * 2 + 1];
      const bx = p[((i + 1) % n) * 2], by = p[((i + 1) % n) * 2 + 1];
      if (ay === by) continue;
      edges.push(ay < by ? { x0: ax, y0: ay, x1: bx, y1: by, dir: 1 } : { x0: bx, y0: by, x1: ax, y1: ay, dir: -1 });
    }
  }
  edges.sort((a, b) => a.y0 - b.y0);
  const xs: { x: number; dir: number }[] = [];
  for (let row = 0; row < h; row++) {
    for (let k = 0; k < SUBSAMPLES; k++) {
      const sy = row + (k + 0.5) / SUBSAMPLES;
      xs.length = 0;
      for (let e = 0; e < edges.length; e++) {
        const E = edges[e];
        if (E.y0 > sy) break;
        if (E.y1 <= sy) continue;
        xs.push({ x: E.x0 + ((sy - E.y0) / (E.y1 - E.y0)) * (E.x1 - E.x0), dir: E.dir });
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        wind += xs[i].dir;
        if (wind === 0) continue;
        addSpan(cov, row * w, w, xs[i].x, xs[i + 1].x, 1 / SUBSAMPLES);
      }
    }
  }
  return cov;
}

function addSpan(cov: Float32Array, rowOff: number, w: number, a: number, b: number, weight: number): void {
  if (b <= 0 || a >= w || b <= a) return;
  a = Math.max(0, a);
  b = Math.min(w, b);
  const ia = Math.floor(a), ib = Math.floor(b);
  if (ia === ib) { cov[rowOff + ia] += (b - a) * weight; return; }
  cov[rowOff + ia] += (ia + 1 - a) * weight;
  for (let x = ia + 1; x < ib; x++) cov[rowOff + x] += weight;
  if (ib < w) cov[rowOff + ib] += (b - ib) * weight;
}

/**
 * The text as an RGBA image exactly the size of its contain-fit inside a
 * boxW×boxH box (so drawContained places it 1:1), in `hex`.
 * Returns null when the font has nothing to draw for it.
 */
export function renderTextImage(font: FontLike, text: string, hex: string, boxW: number, boxH: number): RgbaImage | null {
  const REF = 100;
  const ref = layoutText(font, text, REF);
  const bb = commandBounds(ref);
  if (!bb || boxW < 2 || boxH < 2) return null;
  const fit = containFit({ x: 0, y: 0, w: boxW, h: boxH }, bb.w, bb.h);
  const s = fit.w / bb.w;
  const w = Math.max(1, Math.ceil(fit.w)), h = Math.max(1, Math.ceil(fit.h));
  const cov = rasterizePolygons(flatten(ref, s, -bb.x * s, -bb.y * s), w, h);
  const [r, g, b] = hexToRgb(hex);
  const img = createImage(w, h);
  const d = img.data;
  for (let i = 0; i < cov.length; i++) {
    const c = cov[i];
    if (c <= 0) continue;
    const j = i * 4;
    d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = Math.min(255, Math.round(c * 255));
  }
  return img;
}
