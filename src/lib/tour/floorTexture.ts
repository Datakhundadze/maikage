// Seamless floor-tile texture, generated in code (no image file).
//
// One texture covers `tiles × tiles` tiles and repeats across the floor. Grout
// lines sit on every tile edge, half on each side of the texture border, so
// the repeat has no seam; the noise is per pixel (seamless by nature) plus a
// faint per-tile tone so neighbouring tiles don't look printed. Deterministic:
// the same options always give the same pixels.

export interface FloorTextureOptions {
  /** Texture size in pixels (square; a power of two for mipmaps). */
  size: number;
  /** Tiles across (and down) one texture. */
  tiles: number;
  /** Tile colour and grout colour, "#rrggbb". */
  color: string;
  groutColor: string;
  /** Grout line width as a fraction of one tile. */
  groutFraction: number;
  /** Per-pixel noise amplitude, ± levels (0…255). */
  noise: number;
  seed?: number;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`bad colour ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Small fast PRNG (mulberry32). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RGBA pixels, row by row from the top. */
export function generateFloorTexture(o: FloorTextureOptions): Uint8Array {
  const { size, tiles } = o;
  const tilePx = size / tiles;
  const half = Math.max(0.5, (o.groutFraction * tilePx) / 2);
  const base = hexToRgb(o.color);
  const grout = hexToRgb(o.groutColor);
  const rand = rng(o.seed ?? 7);
  const tileTone: number[] = [];
  for (let i = 0; i < tiles * tiles; i++) tileTone.push((rand() - 0.5) * 6);

  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const ty = Math.floor(y / tilePx);
    // distance (px) from this pixel's centre to the nearest horizontal tile edge
    const fy = (y + 0.5) % tilePx;
    const dy = Math.min(fy, tilePx - fy);
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / tilePx);
      const fx = (x + 0.5) % tilePx;
      const dx = Math.min(fx, tilePx - fx);
      const edge = Math.min(dx, dy);
      // 1 inside the grout line, fading to 0 over one pixel (soft edge)
      const g = Math.max(0, Math.min(1, half + 0.5 - edge));
      const n = (rand() - 0.5) * 2 * o.noise + tileTone[ty * tiles + tx] * (1 - g);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = base[c] + (grout[c] - base[c]) * g + n;
        out[i + c] = Math.max(0, Math.min(255, Math.round(v)));
      }
      out[i + 3] = 255;
    }
  }
  return out;
}
