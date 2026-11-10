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
  back: { x: 375, y: 400, w: 430, h: 620 },
};
export const SRC: Record<Side, { photo: string; mask: string }> = {
  front: { photo: "/tour/lab/oversize-front.webp", mask: "/tour/lab/oversize-front-mask.png" },
  back: { photo: "/tour/lab/oversize-back.webp", mask: "/tour/lab/oversize-back-mask.png" },
};
// the garment's box in the photo (for the print film: the garment alone, cut out)
export const BOX: Record<Side, { x: number; y: number; w: number; h: number }> = {
  front: { x: 120, y: 255, w: 970, h: 1185 },
  back: { x: 110, y: 255, w: 970, h: 1185 },
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

export async function loadSide(side: Side): Promise<SideLayers> {
  const [photo, maskImg] = await Promise.all([loadImg(SRC[side].photo), loadImg(SRC[side].mask)]);
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
