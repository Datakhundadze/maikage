// Minimal PDF writer: one JPEG image per A4 page, full bleed.
//
// The job sheet is drawn on a canvas (so Georgian text renders with the site's
// own web fonts) and each page goes into the PDF as a JPEG (DCTDecode — the
// JPEG bytes are embedded as-is). No dependency, no font embedding.

export interface PdfJpegPage {
  jpeg: Uint8Array;
  /** Pixel size of the JPEG. */
  width: number;
  height: number;
}

const A4_W = 595.28;
const A4_H = 841.89;

export function buildJpegPdf(pages: PdfJpegPage[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array) => { chunks.push(b); pos += b.length; };
  const pushStr = (s: string) => push(enc.encode(s));

  // Object numbers: 1 catalog, 2 pages, then per page: page, content, image.
  const n = pages.length;
  const pageObj = (i: number) => 3 + i * 3;
  const contentObj = (i: number) => 4 + i * 3;
  const imageObj = (i: number) => 5 + i * 3;
  const totalObjs = 2 + n * 3;

  pushStr("%PDF-1.4\n%âãÏÓ\n");
  const startObj = (num: number) => { offsets[num] = pos; pushStr(`${num} 0 obj\n`); };

  startObj(1);
  pushStr("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  startObj(2);
  pushStr(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${n} >>\nendobj\n`);

  pages.forEach((pg, i) => {
    // Fit the image into A4 keeping its aspect (pages are drawn at A4 aspect).
    const scale = Math.min(A4_W / pg.width, A4_H / pg.height);
    const dw = pg.width * scale;
    const dh = pg.height * scale;
    const dx = (A4_W - dw) / 2;
    const dy = (A4_H - dh) / 2;

    startObj(pageObj(i));
    pushStr(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4_W} ${A4_H}] ` +
      `/Resources << /XObject << /Im${i} ${imageObj(i)} 0 R >> >> /Contents ${contentObj(i)} 0 R >>\nendobj\n`,
    );
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im${i} Do Q`;
    startObj(contentObj(i));
    pushStr(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObj(imageObj(i));
    pushStr(
      `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
    );
    push(pg.jpeg);
    pushStr("\nendstream\nendobj\n");
  });

  const xref = pos;
  let x = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) x += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pushStr(x);
  pushStr(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(pos);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
