// The photo designer's garment (RackPhotoDesigner), 2026-11-12 — David: "the
// colours are a bit unnatural — can't we take them from the site? the washed
// tee's photos are there separately, the washed hoodies' too… and the backs".
//
// The garment in the designer is now THE SITE'S OWN PRODUCT PHOTO for the
// chosen colour and side (catalog.findImageForColor — the same picture the
// constructor shows: a real photo where the site has one, e.g. every washed
// colour, otherwise the white one tinted), hung in the rack photo where the
// rack's garment was. Each rack has a copy of its photo with that garment
// taken out (public/tour/garments/<rack>-bg.webp, made offline by
// tools/showroom/make_backgrounds.py) and the box the garment filled.
// So: true colours, a real back for every product, and the same picture the
// customer then sees in the constructor.

import { catalog, FRONT_ONLY_PRODUCTS, type ProductColor, type ProductType } from "@/lib/catalog";
import { canvas, H, W, type Rect, type Side, type SideLayers } from "./garmentPhoto";

export interface RackGarment {
  /** The rack photo without its front garment. */
  bg: string;
  /** The box that garment filled (px of the 1200×1500 photo): where the site's photo is hung. */
  box: Rect;
  /** What it is folded as at the end of the print film; default a tee. */
  kind?: "tee" | "hoodie";
  /** The colour of the garment on the rack photo: the designer opens in it. */
  start?: string;
  /**
   * Front print area as fractions of the hung photo (x, y, w, h), instead of the
   * constructor's zone, and the placement handed to the constructor with it.
   * Zip hoodies: at the heart, beside the zip — a print cannot cross the zip
   * (David 2026-11-12).
   */
  frontArea?: readonly [number, number, number, number];
  placement?: "left-chest";
}

export const RACK_GARMENTS: Record<string, RackGarment> = {
  oversize: { bg: "/tour/garments/oversize-bg.webp", box: { x: 133, y: 264, w: 940, h: 1181 } },
  giordano: { bg: "/tour/garments/giordano-bg.webp", box: { x: 198, y: 408, w: 876, h: 982 }, start: "Black" },
  "washed-tee": { bg: "/tour/garments/washed-tee-bg.webp", box: { x: 127, y: 326, w: 948, h: 1133 }, start: "Black" },
  "gildan-hoodie": { bg: "/tour/garments/gildan-hoodie-bg.webp", box: { x: 117, y: 278, w: 966, h: 1080 }, kind: "hoodie", start: "Black" },
  gildan: { bg: "/tour/garments/gildan-bg.webp", box: { x: 112, y: 363, w: 971, h: 1039 }, start: "Black" },
  "gildan-kids": { bg: "/tour/garments/gildan-kids-bg.webp", box: { x: 147, y: 477, w: 865, h: 815 } },
  hummer: { bg: "/tour/garments/hummer-bg.webp", box: { x: 136, y: 408, w: 926, h: 1014 } },
  polo: { bg: "/tour/garments/polo-bg.webp", box: { x: 104, y: 361, w: 978, h: 1061 }, start: "Dark Navy" },
  sols: { bg: "/tour/garments/sols-bg.webp", box: { x: 149, y: 329, w: 883, h: 1053 }, start: "Black" },
  th: { bg: "/tour/garments/th-bg.webp", box: { x: 114, y: 398, w: 1028, h: 1044 }, start: "Black" },
  "washed-hoodie": { bg: "/tour/garments/washed-hoodie-bg.webp", box: { x: 201, y: 256, w: 781, h: 961 }, kind: "hoodie", start: "Gray" },
  bomber: { bg: "/tour/garments/bomber-bg.webp", box: { x: 87, y: 350, w: 945, h: 1097 }, start: "Black" },
  "jel-zipper": { bg: "/tour/garments/jel-zipper-bg.webp", box: { x: 283, y: 503, w: 719, h: 839 }, kind: "hoodie", start: "Dark Navy", frontArea: [0.53, 0.27, 0.22, 0.19], placement: "left-chest" },
  "jel-standard-zipper": { bg: "/tour/garments/jel-standard-zipper-bg.webp", box: { x: 197, y: 381, w: 765, h: 931 }, kind: "hoodie", start: "Black", frontArea: [0.53, 0.27, 0.22, 0.19], placement: "left-chest" },
  khundadze: { bg: "/tour/garments/khundadze-bg.webp", box: { x: 284, y: 229, w: 658, h: 791 }, start: "Black" },
  nike: { bg: "/tour/garments/nike-bg.webp", box: { x: 192, y: 316, w: 689, h: 696 }, start: "Dark Navy" },
};

export interface SiteSide {
  layers: SideLayers;
  /** Where a print sits (the constructor's own placement zone on that photo). */
  area: Rect;
  /** The hung garment's box (for the print film). */
  box: Rect;
  /** The catalog placement zone of that product photo (fractions of it) — for the order handoff. */
  zone: { x: number; y: number; scale: number; scaleY?: number };
}

const images = new Map<string, Promise<HTMLImageElement>>();
function load(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    p = new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      // some product photos live on the storage host: the canvas must be allowed to read them
      if (/^https?:/.test(src)) i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    images.set(src, p);
  }
  return p;
}

/** Does the site have a back photo for this product? */
export function hasBack(product: ProductType, brand: string): boolean {
  if (FRONT_ONLY_PRODUCTS.has(product)) return false;
  const c = catalog.getAvailableColors(product, brand)[0];
  return !!c && !!catalog.findImageForColor(product, brand, c, "back")?.entry.imageUrl;
}

/**
 * The rack photo with the site's photo of the product (colour, side) hung in
 * it, plus the garment's mask and light for laying a print on it. null = the
 * site has no photo for it.
 */
export async function loadSiteSide(g: RackGarment, product: ProductType, brand: string, color: ProductColor, hex: string, side: Side): Promise<SiteSide | null> {
  const found = catalog.findImageForColor(product, brand, color, side);
  const url = found?.entry.imageUrl;
  if (!found || !url) return null;
  const [bg, img] = await Promise.all([load(g.bg), load(url)]);

  // hang it: as wide / tall as the rack's garment was (cover), its top at the hanger
  const ar = img.naturalWidth / img.naturalHeight;
  let gw = Math.max(g.box.w, g.box.h * ar) * 1.0;
  let gh = gw / ar;
  const gy = Math.max(0, g.box.y - 0.01 * gh);
  if (gy + gh > H - 8) {
    gh = H - 8 - gy;
    gw = gh * ar;
  }
  const box: Rect = { x: Math.round(g.box.x + g.box.w / 2 - gw / 2), y: Math.round(gy), w: Math.round(gw), h: Math.round(gh) };

  const gc = canvas();
  const gg = gc.getContext("2d", { willReadFrequently: true })!;
  gg.drawImage(img, box.x, box.y, box.w, box.h);
  const d = gg.getImageData(0, 0, W, H);
  // mask = the photo's own outline; shade = its light over its bright level (90th percentile)
  const hist = new Uint32Array(256);
  let n = 0;
  const lumAt = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < d.data.length; i += 4, p++) {
    const l = Math.round(0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]);
    lumAt[p] = l;
    if (d.data[i + 3] > 200) {
      hist[l]++;
      n++;
    }
  }
  let ref = 255;
  for (let l = 255, acc = 0; l >= 0; l--) {
    acc += hist[l];
    if (acc > n * 0.1) {
      ref = Math.max(24, l);
      break;
    }
  }
  const md = new ImageData(W, H);
  const sd = new ImageData(W, H);
  for (let i = 0, p = 0; i < d.data.length; i += 4, p++) {
    md.data[i] = md.data[i + 1] = md.data[i + 2] = 255;
    md.data[i + 3] = d.data[i + 3];
    // (for the print only, and gently: a washed or black cloth's own mottling must not eat the print)
    sd.data[i] = sd.data[i + 1] = sd.data[i + 2] = 255 * (0.68 + 0.32 * Math.min(1, lumAt[p] / ref));
    sd.data[i + 3] = 255;
  }
  const mask = canvas();
  mask.getContext("2d")!.putImageData(md, 0, 0);
  const shade = canvas();
  shade.getContext("2d")!.putImageData(sd, 0, 0);

  // no photo of this very colour on the site: the white one in the colour, folds kept.
  // Per pixel: the colour times the cloth's light, the folds a little deeper the darker
  // the colour, and a touch of sheen on dark cloth — so black is cloth, not a flat shape.
  let garment = gc;
  if (!found.isExact && color !== found.entry.color) {
    const v = parseInt(hex.slice(1), 16);
    const r = (v >> 16) & 255;
    const gr = (v >> 8) & 255;
    const b = v & 255;
    const dark = 1 - (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255;
    // the darkest the cloth gets (1st percentile of its light)
    let low = 0;
    for (let l = 0, acc = 0; l < 256; l++) {
      acc += hist[l];
      if (acc > n * 0.01) {
        low = l / ref;
        break;
      }
    }
    const span = Math.max(0.05, 1 - low);
    const td = new ImageData(W, H);
    for (let i = 0, p = 0; i < d.data.length; i += 4, p++) {
      const a = d.data[i + 3];
      if (!a) continue;
      const t = Math.min(1.15, Math.max(0, (lumAt[p] / ref - low) / span));
      const k = Math.pow(0.7 + 0.3 * t, 1 + 1.2 * dark);
      const sheen = 40 * dark * dark * t * t;
      td.data[i] = Math.min(255, r * k + sheen);
      td.data[i + 1] = Math.min(255, gr * k + sheen);
      td.data[i + 2] = Math.min(255, b * k + sheen * 1.06);
      td.data[i + 3] = a;
    }
    garment = canvas();
    garment.getContext("2d")!.putImageData(td, 0, 0);
  }

  const photo = canvas();
  const pg = photo.getContext("2d")!;
  pg.drawImage(bg, 0, 0, W, H);
  // a soft shadow on what is behind: the outline, small and stretched back up (cheap blur)
  const s = canvas(W / 16, H / 16);
  const sg = s.getContext("2d")!;
  sg.drawImage(mask, 0, 0, s.width, s.height);
  sg.globalCompositeOperation = "source-in";
  sg.fillStyle = "#000";
  sg.fillRect(0, 0, s.width, s.height);
  pg.globalAlpha = 0.3;
  pg.imageSmoothingEnabled = true;
  pg.drawImage(s, 8, 20, W, H);
  pg.globalAlpha = 1;
  pg.drawImage(garment, 0, 0);

  // the constructor's own zone on this photo: centre (x, y), width = scale; a little room around it
  const z = found.entry.placementZone;
  const aw = Math.min(0.5, z.scale * 1.25) * box.w;
  const ah = (z.scaleY ? z.scaleY * 1.05 : 0.46) * box.h;
  const fa = side === "front" ? g.frontArea : undefined;
  const area: Rect = fa
    ? { x: Math.round(box.x + fa[0] * box.w), y: Math.round(box.y + fa[1] * box.h), w: Math.round(fa[2] * box.w), h: Math.round(fa[3] * box.h) }
    : { x: Math.round(box.x + z.x * box.w - aw / 2), y: Math.round(box.y + z.y * box.h - ah / 2), w: Math.round(aw), h: Math.round(ah) };
  return { layers: { photo, mask, shade }, area, box, zone: { x: z.x, y: z.y, scale: z.scale, ...(z.scaleY ? { scaleY: z.scaleY } : {}) } };
}
