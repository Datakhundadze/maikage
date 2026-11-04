// Stamp a DPI into a PNG (pHYs chunk) so RIP / Photoshop open the print file
// at its real physical size instead of 72 DPI. canvas.toBlob never writes
// pHYs; this inserts one right after IHDR (replacing an existing one).

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
}

/** Returns a new PNG byte array carrying `dpi` in pHYs. Non-PNG input is returned unchanged. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) return png;
  const ppm = Math.round(dpi / 0.0254);

  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  writeU32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  writeU32(chunk, 8, ppm);
  writeU32(chunk, 12, ppm);
  chunk[16] = 1; // unit: metre
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));

  // Walk chunks: keep everything except an old pHYs; insert after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let o = 8;
  while (o + 8 <= png.length) {
    const len = readU32(png, o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const end = o + 12 + len;
    if (end > png.length) break;
    if (type !== "pHYs") parts.push(png.subarray(o, end));
    if (type === "IHDR") parts.push(chunk);
    o = end;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}

/** Reads the DPI from a PNG's pHYs chunk, or null. (Used by tests and checks.) */
export function readPngDpi(png: Uint8Array): number | null {
  let o = 8;
  while (o + 8 <= png.length) {
    const len = readU32(png, o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (type === "pHYs" && png[o + 16] === 1) return Math.round(readU32(png, o + 8) * 0.0254);
    o += 12 + len;
  }
  return null;
}
