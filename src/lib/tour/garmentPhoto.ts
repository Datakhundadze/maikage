// The showroom's "design on the rack photo" pieces shared by the prototype
// page (/showroom/lab) and the rack card's large photo (RackPhotoDesigner):
// where the photos are, where a print sits on them, and the "shade" map that
// lets the cloth's folds run through a colour or a print. Canvas 2D only;
// nothing here knows about products, prices or orders.

export type Side = "front" | "back";
export const W = 1200;
export const H = 1500;
// where a print sits on the garment in the photo (px of the 1200×1500 photo)
export const AREA: Record<Side, { x: number; y: number; w: number; h: number }> = {
  front: { x: 395, y: 470, w: 430, h: 560 },
  back: { x: 395, y: 400, w: 430, h: 620 },
};
export const SRC: Record<Side, { photo: string; mask: string }> = {
  front: { photo: "/tour/lab/oversize-front.webp", mask: "/tour/lab/oversize-front-mask.png" },
  back: { photo: "/tour/lab/oversize-back.webp", mask: "/tour/lab/oversize-back-mask.png" },
};
// the garment's box in the photo (for the print film: the garment alone, cut out)
export const BOX: Record<Side, { x: number; y: number; w: number; h: number }> = {
  front: { x: 120, y: 255, w: 970, h: 1185 },
  back: { x: 120, y: 255, w: 970, h: 1185 },
};
export interface SideLayers {
  photo: HTMLImageElement;
  mask: HTMLCanvasElement; // alpha = the garment
  shade: HTMLCanvasElement; // grey: the white garment's light, 1 = flat lit cloth
}

export const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
export const canvas = (w = W, h = H) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export async function loadSide(side: Side, src: { photo: string; mask: string } = SRC[side]): Promise<SideLayers> {
  const [photo, maskImg] = await Promise.all([loadImg(src.photo), loadImg(src.mask)]);
  // mask file is a grey picture → alpha
  const mask = canvas();
  const mg = mask.getContext("2d", { willReadFrequently: true })!;
  mg.drawImage(maskImg, 0, 0, W, H);
  const md = mg.getImageData(0, 0, W, H);
  // shade = photo luminance over the garment's bright level (90th percentile inside the mask)
  const pc = canvas();
  const pg = pc.getContext("2d", { willReadFrequently: true })!;
  pg.drawImage(photo, 0, 0, W, H);
  const pd = pg.getImageData(0, 0, W, H);
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < md.data.length; i += 4) {
    const a = md.data[i];
    md.data[i + 3] = a;
    md.data[i] = md.data[i + 1] = md.data[i + 2] = 255;
    if (a > 200) {
      const l = Math.round(0.2126 * pd.data[i] + 0.7152 * pd.data[i + 1] + 0.0722 * pd.data[i + 2]);
      hist[l]++;
      n++;
    }
  }
  let ref = 255;
  for (let l = 255, acc = 0; l >= 0; l--) {
    acc += hist[l];
    if (acc > n * 0.1) {
      ref = l;
      break;
    }
  }
  mg.putImageData(md, 0, 0);
  for (let i = 0; i < pd.data.length; i += 4) {
    const l = 0.2126 * pd.data[i] + 0.7152 * pd.data[i + 1] + 0.0722 * pd.data[i + 2];
    const s = Math.min(255, (l / ref) * 255);
    pd.data[i] = pd.data[i + 1] = pd.data[i + 2] = s;
    pd.data[i + 3] = 255;
  }
  const shade = canvas();
  shade.getContext("2d")!.putImageData(pd, 0, 0);
  return { photo, mask, shade };
}

export function lum(hex: string): number {
  const v = parseInt(hex.slice(1), 16);
  return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** One side of a garment on its rack photo: the photo with the garment WHITE, its mask, where a print sits, the garment's box. */
export interface GarmentSide {
  photo: string;
  mask: string;
  area: Rect;
  box: Rect;
}
/**
 * A rack's garment that can be designed on its photo (RackPhotoDesigner).
 * Every side's photo shows the garment in white: colours are tinted from it
 * on the canvas with the cloth's own folds. `colorPhoto` = ready photos for
 * colours that look better photographed than tinted (black above all).
 *
 * Where the rack photo shows a dark garment the white photo was made offline
 * from it (tools/showroom/make_garments.py) (2026-11-11: mask
 * by GrabCut, the cloth's light taken from the dark cloth and compressed,
 * print area and box from the mask's bounds), and the rack photo itself is
 * the ready photo of that colour.
 */
export interface GarmentSpec {
  sides: Partial<Record<Side, GarmentSide>>;
  colorPhoto?: Record<string, Partial<Record<Side, string>>>;
  /** The colour the designer opens in (the one on the rack photo); default: the brand's first. */
  start?: string;
  /** What it is folded as at the end of the print film; default a tee. */
  kind?: "tee" | "hoodie";
}
export const GARMENTS: Record<string, GarmentSpec> = {
  oversize: {
    sides: {
      front: { ...SRC.front, area: AREA.front, box: BOX.front },
      back: { ...SRC.back, area: AREA.back, box: BOX.back },
    },
    // the same photo with the cloth re-toned (collar, seams, folds kept)
    colorPhoto: { Black: { front: "/tour/lab/oversize-front-black.webp", back: "/tour/lab/oversize-back-black.webp" } },
  },
  giordano: {
    sides: {
      front: {
        photo: "/tour/garments/giordano-front.webp",
        mask: "/tour/garments/giordano-front-mask.png",
        area: { x: 448, y: 588, w: 385, h: 461 },
        box: { x: 187, y: 397, w: 898, h: 1004 },
      },
    },
    colorPhoto: { Black: { front: "/tour/racks/giordano.webp" } },
    start: "Black",
  },
  "washed-tee": {
    sides: {
      front: {
        photo: "/tour/garments/washed-tee-front.webp",
        mask: "/tour/garments/washed-tee-front-mask.png",
        area: { x: 397, y: 533, w: 417, h: 533 },
        box: { x: 116, y: 315, w: 970, h: 1155 },
      },
    },
    colorPhoto: { Black: { front: "/tour/racks/washed-tee.webp" } },
    start: "Black",
  },
  "gildan-hoodie": {
    sides: {
      front: {
        photo: "/tour/garments/gildan-hoodie-front.webp",
        mask: "/tour/garments/gildan-hoodie-front-mask.png",
        area: { x: 408, y: 603, w: 384, h: 290 },
        box: { x: 106, y: 267, w: 988, h: 1102 },
      },
    },
    colorPhoto: { Black: { front: "/tour/racks/gildan-hoodie.webp" } },
    start: "Black",
    kind: "hoodie",
  },
  // 2026-11-12: the rest of the racks with one garment in front (same offline method)
  gildan: {
    sides: {
      front: {
        photo: "/tour/garments/gildan-front.webp",
        mask: "/tour/garments/gildan-front-mask.png",
        area: { x: 389, y: 553, w: 427, h: 488 },
        box: { x: 101, y: 352, w: 993, h: 1061 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/gildan.webp" } },
    start: "Black",
  },
  "gildan-kids": {
    sides: {
      front: {
        photo: "/tour/garments/gildan-kids-front.webp",
        mask: "/tour/garments/gildan-kids-front-mask.png",
        area: { x: 394, y: 626, w: 381, h: 382 },
        box: { x: 136, y: 466, w: 887, h: 837 },
      },
    },
  },
  hummer: {
    sides: {
      front: {
        photo: "/tour/garments/hummer-front.webp",
        mask: "/tour/garments/hummer-front-mask.png",
        area: { x: 400, y: 593, w: 408, h: 476 },
        box: { x: 125, y: 397, w: 948, h: 1036 },
      },
    },
  },
  polo: {
    sides: {
      front: {
        photo: "/tour/garments/polo-front.webp",
        mask: "/tour/garments/polo-front-mask.png",
        area: { x: 389, y: 680, w: 408, h: 422 },
        box: { x: 93, y: 350, w: 1000, h: 1083 },
      },
    },
    colorPhoto: { "Dark Navy": { front: "/tour/racks/polo.webp" } },
    start: "Dark Navy",
  },
  sols: {
    sides: {
      front: {
        photo: "/tour/garments/sols-front.webp",
        mask: "/tour/garments/sols-front-mask.png",
        area: { x: 401, y: 522, w: 389, h: 495 },
        box: { x: 138, y: 318, w: 905, h: 1075 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/sols.webp" } },
    start: "Black",
  },
  th: {
    sides: {
      front: {
        photo: "/tour/garments/th-front.webp",
        mask: "/tour/garments/th-front-mask.png",
        area: { x: 407, y: 589, w: 453, h: 491 },
        box: { x: 103, y: 387, w: 1050, h: 1066 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/th.webp" } },
    start: "Black",
  },
  "washed-hoodie": {
    sides: {
      front: {
        photo: "/tour/garments/washed-hoodie-front.webp",
        mask: "/tour/garments/washed-hoodie-front-mask.png",
        area: { x: 436, y: 546, w: 310, h: 258 },
        box: { x: 190, y: 245, w: 803, h: 983 },
      },
    },
    colorPhoto: { "Gray": { front: "/tour/racks/washed-hoodie.webp" } },
    start: "Gray",
    kind: "hoodie",
  },
  bomber: {
    sides: {
      front: {
        photo: "/tour/garments/bomber-front.webp",
        mask: "/tour/garments/bomber-front-mask.png",
        area: { x: 356, y: 550, w: 416, h: 516 },
        box: { x: 76, y: 339, w: 967, h: 1119 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/bomber.webp" } },
    start: "Black",
  },
  "jel-zipper": {
    sides: {
      front: {
        photo: "/tour/garments/jel-zipper-front.webp",
        mask: "/tour/garments/jel-zipper-front-mask.png",
        area: { x: 682, y: 756, w: 178, h: 167 },
        box: { x: 272, y: 492, w: 741, h: 861 },
      },
    },
    colorPhoto: { "Dark Navy": { front: "/tour/racks/jel-zipper.webp" } },
    start: "Dark Navy",
    kind: "hoodie",
  },
  "jel-standard-zipper": {
    sides: {
      front: {
        photo: "/tour/garments/jel-standard-zipper-front.webp",
        mask: "/tour/garments/jel-standard-zipper-front-mask.png",
        area: { x: 621, y: 662, w: 190, h: 185 },
        box: { x: 186, y: 370, w: 787, h: 953 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/jel-standard-zipper.webp" } },
    start: "Black",
    kind: "hoodie",
  },
  khundadze: {
    sides: {
      front: {
        photo: "/tour/garments/khundadze-front.webp",
        mask: "/tour/garments/khundadze-front-mask.png",
        area: { x: 472, y: 374, w: 289, h: 371 },
        box: { x: 273, y: 218, w: 680, h: 813 },
      },
    },
    colorPhoto: { "Black": { front: "/tour/racks/khundadze.webp" } },
    start: "Black",
  },
  nike: {
    sides: {
      front: {
        photo: "/tour/garments/nike-front.webp",
        mask: "/tour/garments/nike-front-mask.png",
        area: { x: 389, y: 444, w: 303, h: 326 },
        box: { x: 181, y: 305, w: 711, h: 718 },
      },
    },
    colorPhoto: { "Dark Navy": { front: "/tour/racks/nike.webp" } },
    start: "Dark Navy",
  },
};

// ── drawing a designed garment (RackPhotoDesigner) ──────────────────────────

export interface GarmentDesign {
  img: HTMLImageElement | null;
  text: string;
  /** CSS font-family for the text. */
  font: string;
  /** Text colour; null = black on light cloth, white on dark. */
  textColor: string | null;
  x: number; // centre, 0..1 of the print area
  y: number;
  scale: number; // 1 = as wide as the print area
}

/** Scratch canvases (W×H) the drawing reuses: a = recoloured garment, b = the print, c = shade under the print. */
export interface GarmentScratch {
  a: HTMLCanvasElement;
  b: HTMLCanvasElement;
  c: HTMLCanvasElement;
}
export const garmentScratch = (): GarmentScratch => ({ a: canvas(), b: canvas(), c: canvas() });

/**
 * The photo with the garment in `hex` and the design on it. `recolor` false =
 * the photo's own (white) garment. Leaves the recoloured garment in s.a and
 * the print layer in s.b for garmentFilm(). `A` = the print area. `base` = a
 * ready photo of the garment in that colour (GarmentSpec.colorPhoto), used
 * instead of recolouring.
 */
export function drawGarment(g: CanvasRenderingContext2D, L: SideLayers, A: Rect, hex: string, recolor: boolean, d: GarmentDesign, s: GarmentScratch, base?: HTMLImageElement | null): void {
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
  g.drawImage(base ?? L.photo, 0, 0, W, H);
  if (recolor && !base) {
    const a = s.a.getContext("2d")!;
    a.globalCompositeOperation = "source-over";
    a.globalAlpha = 1;
    // very dark cloth still shows its folds: lift the colour a little
    const dark = 1 - lum(hex);
    const v = parseInt(hex.slice(1), 16);
    const lift = Math.round(34 * dark * dark);
    a.fillStyle = `rgb(${Math.min(255, ((v >> 16) & 255) + lift)}, ${Math.min(255, ((v >> 8) & 255) + lift)}, ${Math.min(255, (v & 255) + lift)})`;
    a.fillRect(0, 0, W, H);
    a.globalCompositeOperation = "multiply";
    a.drawImage(L.shade, 0, 0);
    a.globalCompositeOperation = "destination-in";
    a.drawImage(L.mask, 0, 0);
    g.drawImage(s.a, 0, 0);
  }
  const b = s.b.getContext("2d")!;
  b.globalCompositeOperation = "source-over";
  b.globalAlpha = 1;
  b.clearRect(0, 0, W, H);
  if (!d.img && !d.text) return;
  const cx = A.x + d.x * A.w;
  const cy = A.y + d.y * A.h;
  const w = A.w * d.scale;
  const ih = d.img ? (w * d.img.naturalHeight) / d.img.naturalWidth : 0;
  if (d.img) b.drawImage(d.img, cx - w / 2, cy - ih / 2, w, ih);
  if (d.text) {
    const size = Math.max(18, w * 0.16);
    b.font = `700 ${size}px ${d.font}`;
    b.textAlign = "center";
    b.textBaseline = "middle";
    b.fillStyle = d.textColor ?? (lum(hex) > 0.55 ? "#141414" : "#f6f6f6");
    b.fillText(d.text, cx, d.img ? cy + ih / 2 + size * 0.9 : cy, A.w * 1.05);
  }
  // the cloth's folds through the print, and nothing outside the garment
  const c = s.c.getContext("2d")!;
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, W, H);
  c.drawImage(L.shade, 0, 0);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(s.b, 0, 0);
  b.globalCompositeOperation = "multiply";
  b.drawImage(s.c, 0, 0);
  b.globalCompositeOperation = "destination-in";
  b.drawImage(L.mask, 0, 0);
  g.globalAlpha = 0.95;
  g.drawImage(s.b, 0, 0);
  g.globalAlpha = 1;
}

/** The four pictures the print film needs, from what drawGarment() left in the scratch canvases; null = nothing printed. */
export function garmentFilm(L: SideLayers, B: Rect, recolor: boolean, s: GarmentScratch, base?: HTMLImageElement | null): { designSrc: string; garmentBlankSrc: string; garmentPrintedSrc: string; printLayerSrc: string } | null {
  const crop = (src: HTMLCanvasElement, x = B.x, y = B.y, w = B.w, h = B.h) => {
    const c = canvas(w, h);
    c.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h);
    return c;
  };
  const d = s.b.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < H; y += 2)
    for (let x = 0; x < W; x += 2)
      if (d[(y * W + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 <= x0 || y1 <= y0) return null;
  const garment = canvas();
  const g = garment.getContext("2d")!;
  g.drawImage(base ?? L.photo, 0, 0, W, H);
  if (recolor && !base) g.drawImage(s.a, 0, 0);
  g.globalCompositeOperation = "destination-in";
  g.drawImage(L.mask, 0, 0);
  const blank = crop(garment);
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 0.95;
  g.drawImage(s.b, 0, 0);
  return {
    designSrc: crop(s.b, x0, y0, x1 - x0 + 2, y1 - y0 + 2).toDataURL("image/png"),
    garmentBlankSrc: blank.toDataURL("image/png"),
    garmentPrintedSrc: crop(garment).toDataURL("image/png"),
    printLayerSrc: crop(s.b).toDataURL("image/png"),
  };
}
