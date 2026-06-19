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
 * Key a bright-green chroma background out to transparency.
 * Returns a transparent PNG data URL (or the input unchanged if a 2D context
 * isn't available).
 */
export async function chromaKeyGreen(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return dataUrl;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
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
  return canvas.toDataURL("image/png");
}
