// Minimal PNG decoder → RGBA8 (pure; runs in Deno and in vitest/Node 18+).
//
// Why not a library: the pure-JS image libraries that run in Supabase's edge
// runtime either need native Node addons (imagescript's npm build encodes JPEG
// natively) or pull floating sub-dependencies. PNG is simple enough to decode
// here: the zlib stream goes through the platform's own DecompressionStream,
// and only chunk parsing, unfiltering and channel expansion are JavaScript.
//
// Supported: every colour type (grey, RGB, palette, grey+alpha, RGBA), bit
// depths 1/2/4/8/16, tRNS transparency. Not supported: Adam7 interlacing
// (none of the catalog photos or GPT outputs use it) → throws, and the caller
// sends the link line instead.

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major, NOT premultiplied. */
  data: Uint8ClampedArray;
}

/** Hard size cap: 4096×4096 RGBA is 64 MB, a quarter of the edge memory limit. */
export const MAX_PNG_PIXELS = 4096 * 4096;

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && SIG.every((v, i) => b[i] === v);
}

export function isJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** zlib (RFC 1950) inflate with the platform's DecompressionStream. */
export async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export async function decodePng(
  bytes: Uint8Array,
  inflate: (b: Uint8Array) => Promise<Uint8Array> = inflateZlib,
): Promise<RgbaImage> {
  if (!isPng(bytes)) throw new Error("png: bad signature");
  let o = 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = u32(bytes, o);
    const type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const start = o + 8;
    if (start + len > bytes.length) throw new Error("png: truncated chunk");
    const data = bytes.subarray(start, start + len);
    if (type === "IHDR") {
      width = u32(data, 0);
      height = u32(data, 4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o = start + len + 4; // + CRC
  }
  if (!width || !height) throw new Error("png: no IHDR");
  if (width * height > MAX_PNG_PIXELS) throw new Error("png: too large");
  if (interlace !== 0) throw new Error("png: interlaced");
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ctype];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error("png: unsupported format");
  if (ctype === 3 && !palette) throw new Error("png: missing palette");

  let total = 0;
  for (const c of idat) total += c.length;
  const joined = new Uint8Array(total);
  let p = 0;
  for (const c of idat) { joined.set(c, p); p += c.length; }
  const raw = await inflate(joined);

  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3); // filter byte distance
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  if (raw.length < height * (stride + 1)) throw new Error("png: short image data");

  // Unfilter in place into `cur`, row by row.
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const src = raw.subarray(rowStart + 1, rowStart + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error("png: bad filter");
      }
      cur[i] = v & 255;
    }
    expandRow(cur, y, width, ctype, depth, palette, trns, out);
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, data: out };
}

function sample(row: Uint8Array, idx: number, depth: number): number {
  if (depth === 8) return row[idx];
  if (depth === 16) return row[idx * 2]; // high byte
  const perByte = 8 / depth;
  const byte = row[Math.floor(idx / perByte)];
  const shift = 8 - depth * ((idx % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function expandRow(
  row: Uint8Array, y: number, width: number, ctype: number, depth: number,
  palette: Uint8Array | null, trns: Uint8Array | null, out: Uint8ClampedArray,
): void {
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  let o = y * width * 4;
  // tRNS for grey / RGB is a 16-bit key in the image's own bit depth.
  const key16 = (i: number) => (trns ? (trns[i * 2] << 8) | trns[i * 2 + 1] : -1);
  for (let x = 0; x < width; x++, o += 4) {
    switch (ctype) {
      case 0: {
        const raw = depth === 16 ? (row[x * 2] << 8) | row[x * 2 + 1] : sample(row, x, depth);
        const g = depth === 16 ? row[x * 2] : Math.round(sample(row, x, depth) * scale);
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = trns && raw === key16(0) ? 0 : 255;
        break;
      }
      case 2: {
        const ch = depth === 16 ? 6 : 3;
        const r = row[x * ch], g = row[x * ch + (depth === 16 ? 2 : 1)], b = row[x * ch + (depth === 16 ? 4 : 2)];
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
        let a = 255;
        if (trns) {
          const rr = depth === 16 ? (row[x * 6] << 8) | row[x * 6 + 1] : r;
          const gg = depth === 16 ? (row[x * 6 + 2] << 8) | row[x * 6 + 3] : g;
          const bb = depth === 16 ? (row[x * 6 + 4] << 8) | row[x * 6 + 5] : b;
          if (rr === key16(0) && gg === key16(1) && bb === key16(2)) a = 0;
        }
        out[o + 3] = a;
        break;
      }
      case 3: {
        const i = sample(row, x, depth);
        out[o] = palette![i * 3]; out[o + 1] = palette![i * 3 + 1]; out[o + 2] = palette![i * 3 + 2];
        out[o + 3] = trns && i < trns.length ? trns[i] : 255;
        break;
      }
      case 4: {
        const ch = depth === 16 ? 4 : 2;
        const g = row[x * ch];
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = row[x * ch + (depth === 16 ? 2 : 1)];
        break;
      }
      case 6: {
        if (depth === 16) {
          out[o] = row[x * 8]; out[o + 1] = row[x * 8 + 2]; out[o + 2] = row[x * 8 + 4]; out[o + 3] = row[x * 8 + 6];
        } else {
          const i = x * 4;
          out[o] = row[i]; out[o + 1] = row[i + 1]; out[o + 2] = row[i + 2]; out[o + 3] = row[i + 3];
        }
        break;
      }
    }
  }
}
