// Photo background-removal keying. The gemini-proxy "isolate-subject" action
// returns the subject on a solid bright-green (#00FF00) chroma-key background;
// this keys that green out to transparent.
//
// This is a SEPARATE path from the design/generation transparency pipeline
// (runTransparencyPipeline + convert-bg-black + difference matting), which is
// built for flat generated artwork on clean white and produces a binary
// silhouette/mask when fed a photographic subject. Green keys far more reliably
// for photos than white (white punches holes in white/skin/highlight regions),
// and a border-seeded flood-fill only removes green CONNECTED to the edges, so
// green that's actually part of the subject is preserved (no interior holes).

/** Greenness = how much the green channel dominates the other two. The chroma
 *  screen (#00FF00) is ~255; real-subject pixels are ≤ 0. */
function greennessAt(px: Uint8ClampedArray, i: number): number {
  return px[i + 1] - Math.max(px[i], px[i + 2]);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * What the key actually did — so the caller can judge the outcome.
 *
 * ⚠️ THE KEY CANNOT THROW ON A WRONG-COLOUR BACKDROP, and that silence shipped
 * a wrong print file to a paying customer: the model returned the subject on a
 * BEIGE backdrop instead of green, the flood fill found nothing to key, the
 * unchanged image came back, and the caller declared success. `keyedFraction`
 * is the judgement handle: the share of the image the fill actually made
 * transparent. A real green backdrop keys the whole margin around the subject
 * (measured ≥ ~0.11 even with the subject filling 88% of the frame, ~0.5-0.6
 * typically); a wrong-colour backdrop keys exactly 0. The caller decides the
 * threshold — this module only reports.
 */
export interface ChromaKeyResult {
  /** Transparent PNG data URL — or the INPUT UNCHANGED on the mechanical
   *  bail-outs (unloadable image, no 2D context), which also report 0. */
  image: string;
  /** Fraction of all pixels the flood fill made fully transparent, 0..1.
   *  Counts only the keyed background, not the despill fade on kept edges. */
  keyedFraction: number;
}

/**
 * Key a bright-green chroma background out to transparency.
 */
export async function chromaKeyGreen(dataUrl: string): Promise<ChromaKeyResult> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return { image: dataUrl, keyedFraction: 0 };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image: dataUrl, keyedFraction: 0 };
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const px = imageData.data;

  // Pixels greener than this are treated as chroma background. Pure #00FF00 is
  // ~255; tuned so the saturated screen + its anti-aliased edge are caught
  // while moderately-green subject regions are not.
  const GREEN_BG = 60;

  // Border-seeded BFS flood-fill: only zero the alpha of green pixels
  // reachable from the image edge through a chain of green neighbours, so a
  // green element INSIDE the subject stays opaque (no holes). Mirrors the
  // design pipeline's connected-white removal, kept here as a standalone
  // photo-path helper so that pipeline stays byte-stable.
  const visited = new Uint8Array(w * h);
  const queue: number[] = [];
  const seed = (p: number) => {
    if (!visited[p] && greennessAt(px, p * 4) > GREEN_BG) {
      visited[p] = 1;
      queue.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x); // top row
    seed((h - 1) * w + x); // bottom row
  }
  for (let y = 1; y < h - 1; y++) {
    seed(y * w); // left col
    seed(y * w + (w - 1)); // right col
  }

  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    px[pos * 4 + 3] = 0; // transparent
    const x = pos % w;
    const y = (pos / w) | 0;
    const neighbours = [
      x > 0 ? pos - 1 : -1,
      x < w - 1 ? pos + 1 : -1,
      y > 0 ? pos - w : -1,
      y < h - 1 ? pos + w : -1,
    ];
    for (const n of neighbours) {
      if (n >= 0 && !visited[n]) {
        visited[n] = 1;
        if (greennessAt(px, n * 4) > GREEN_BG) queue.push(n);
      }
    }
  }

  // Edge cleanup on KEPT pixels: anti-aliased boundary pixels still lean green
  // (a green fringe). Suppress the green spill and softly fade alpha so the
  // cutout edge is clean rather than haloed.
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const gx = greennessAt(px, i);
    if (gx > 0) {
      px[i + 1] = Math.max(px[i], px[i + 2]); // despill: clamp green excess
      if (gx > GREEN_BG / 2) {
        const fade = Math.min(1, (gx - GREEN_BG / 2) / (GREEN_BG / 2)) * 0.6;
        px[i + 3] = Math.round(px[i + 3] * (1 - fade));
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
  // queue holds exactly the pixels the fill zeroed — every entry was pushed
  // once (visited guards re-pushes) and every entry's alpha was set to 0.
  return { image: canvas.toDataURL("image/png"), keyedFraction: queue.length / (w * h) };
}

// ── DESIGN variant (add-only) ───────────────────────────────────────────────
// For AI DESIGNS (lettering, rays, outlined shapes) returned on #00FF00 by the
// gemini-proxy "isolate-design" / "edit-image-cutout" actions. chromaKeyGreen
// above is untouched and still serves uploaded photos.
//
// WHY A SECOND PASS. A border-seeded fill only reaches green CONNECTED to the
// frame edge. In a design the backdrop also shows through enclosed gaps — the
// counter of an "o", the space between sun rays, the inside of a frame — and
// that green stayed opaque and printed. For a photo that rule is right (a green
// shirt must not get holes); for a design whose prompt forbids green inside the
// artwork, near-pure screen green anywhere is backdrop.
//
// Pass 2 seeds ONLY from near-pure screen green (g > 200, r < 80, b < 80) not
// already keyed, then grows through the same GREEN_BG greenness test as pass 1
// so a hole's anti-aliased rim goes with it. Moderately green artwork can never
// start a fill on its own.

/** Near-pure chroma green: the only colour pass 2 may start a fill from. */
function isScreenGreen(px: Uint8ClampedArray, i: number): boolean {
  return px[i + 1] > 200 && px[i] < 80 && px[i + 2] < 80;
}

/**
 * Pure pixel worker for chromaKeyGreenDesign — exported for unit tests (jsdom
 * has no canvas). Mutates `px` (RGBA, w*h*4) in place.
 *
 * @returns `borderKeyed` — pixels keyed by the edge-seeded fill (the backdrop
 *   proper; this is what keyedFraction reports, so the caller's "< 2% → the
 *   model returned a wrong-colour backdrop" check keeps exactly its photo-path
 *   meaning) and `enclosedKeyed` — pixels keyed by the second pass.
 */
export function keyGreenDesignPixels(
  px: Uint8ClampedArray,
  w: number,
  h: number,
): { borderKeyed: number; enclosedKeyed: number } {
  const GREEN_BG = 60; // same threshold as chromaKeyGreen
  const visited = new Uint8Array(w * h);

  const fill = (queue: number[]): number => {
    let head = 0;
    while (head < queue.length) {
      const pos = queue[head++];
      px[pos * 4 + 3] = 0;
      const x = pos % w;
      const y = (pos / w) | 0;
      const neighbours = [
        x > 0 ? pos - 1 : -1,
        x < w - 1 ? pos + 1 : -1,
        y > 0 ? pos - w : -1,
        y < h - 1 ? pos + w : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !visited[n]) {
          visited[n] = 1;
          if (greennessAt(px, n * 4) > GREEN_BG) queue.push(n);
        }
      }
    }
    return queue.length;
  };

  // Pass 1 — identical to chromaKeyGreen: border-seeded flood fill.
  const borderQueue: number[] = [];
  const seedBorder = (p: number) => {
    if (!visited[p] && greennessAt(px, p * 4) > GREEN_BG) {
      visited[p] = 1;
      borderQueue.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seedBorder(x);
    seedBorder((h - 1) * w + x);
  }
  for (let y = 1; y < h - 1; y++) {
    seedBorder(y * w);
    seedBorder(y * w + (w - 1));
  }
  const borderKeyed = fill(borderQueue);

  // Pass 2 — enclosed screen green. `visited` is shared, so pass-1 pixels and
  // the kept neighbours it already examined are never re-processed; a kept
  // pixel examined by pass 1 failed the greenness test and cannot be screen
  // green, so nothing pass 2 should key is hidden by that marking.
  let enclosedKeyed = 0;
  for (let p = 0; p < w * h; p++) {
    if (visited[p] || !isScreenGreen(px, p * 4)) continue;
    visited[p] = 1;
    enclosedKeyed += fill([p]);
  }

  // Edge cleanup on KEPT pixels — same de-green math as chromaKeyGreen, but
  // only on the actual cutout EDGE (within 2px of a keyed pixel). chromaKeyGreen
  // runs it on every kept pixel, which on a design would grey out and fade any
  // green ARTWORK (a leaf, a logo); the anti-aliased fringe it exists for is
  // always next to the key.
  const keyed = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (px[p * 4 + 3] === 0) keyed[p] = 1;
  const nearKeyed = (p: number): boolean => {
    const x0 = p % w;
    const y0 = (p / w) | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const y = y0 + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const x = x0 + dx;
        if (x >= 0 && x < w && keyed[y * w + x]) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const gx = greennessAt(px, i);
    if (gx > 0 && nearKeyed(i / 4)) {
      px[i + 1] = Math.max(px[i], px[i + 2]);
      if (gx > GREEN_BG / 2) {
        const fade = Math.min(1, (gx - GREEN_BG / 2) / (GREEN_BG / 2)) * 0.6;
        px[i + 3] = Math.round(px[i + 3] * (1 - fade));
      }
    }
  }

  return { borderKeyed, enclosedKeyed };
}

/**
 * Key a #00FF00 backdrop out of an AI DESIGN, including green trapped inside
 * letters and between shapes. Same result shape as chromaKeyGreen; the
 * `keyedFraction` it reports is the BORDER-connected backdrop only, so the
 * caller's existing < 0.02 failure threshold means what it means on the photo
 * path (a wrong-colour backdrop keys 0 there, and still keys ~0 here).
 */
export async function chromaKeyGreenDesign(dataUrl: string): Promise<ChromaKeyResult> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return { image: dataUrl, keyedFraction: 0 };

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image: dataUrl, keyedFraction: 0 };
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, w, h);
  const { borderKeyed } = keyGreenDesignPixels(imageData.data, w, h);
  ctx.putImageData(imageData, 0, 0);
  return { image: canvas.toDataURL("image/png"), keyedFraction: borderKeyed / (w * h) };
}
