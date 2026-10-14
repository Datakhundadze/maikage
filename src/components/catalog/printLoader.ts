import { transformedDisplayUrl } from "@/lib/imageTransform";

// Print images for the showroom rail and stage, shared by both.
//
// requestPrint(raw) loads the 480 px transformed version of a design image
// (falling back to the raw URL if the transform fails), decodes it, then — in
// idle time — trims its transparent margins to the opaque bounding box. The
// result (a data URL, or the loaded URL when the canvas is tainted or trimming
// fails) is cached by the raw URL. At most a few loads run at once; a print
// requested with high priority, or bumped (e.g. its garment just turned),
// jumps the queue and is trimmed right away instead of waiting for idle time.

type Task = {
  raw: string;
  high: boolean;
  started: boolean;
  promise: Promise<string>;
  resolve: (url: string) => void;
  /** Set while waiting for idle time to trim; calling it trims now. */
  trimNow?: () => void;
  img?: HTMLImageElement;
};

const MAX_ACTIVE = 4;
const tasks = new Map<string, Task>();
const done = new Map<string, string>();
const queue: Task[] = [];
let active = 0;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

function onIdle(fn: () => void): () => void {
  const w = window as IdleWindow;
  if (w.requestIdleCallback && w.cancelIdleCallback) {
    const id = w.requestIdleCallback(fn, { timeout: 1500 });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(fn, 30);
  return () => window.clearTimeout(id);
}

function loadImage(url: string, high: boolean): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = high ? "high" : "low";
  img.src = url;
  return img.decode().then(() => img);
}

/** Crop to the alpha > 20 bounding box (measured on a ≤400 px copy). Throws if the canvas is tainted. */
function trim(img: HTMLImageElement): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) return null;
  const s = Math.min(1, 400 / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data; // throws if tainted
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (data[(y * cw + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === cw - 1 && y1 === ch - 1)) return null;
  const sx = x0 / s, sy = y0 / s, sw = (x1 - x0 + 1) / s, sh = (y1 - y0 + 1) / s;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw));
  out.height = Math.max(1, Math.round(sh));
  out.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

async function run(t: Task): Promise<void> {
  t.started = true;
  active++;
  let img: HTMLImageElement | null = null;
  try {
    img = await loadImage(transformedDisplayUrl(t.raw, { width: 480, quality: 70 }), t.high);
  } catch {
    try {
      img = await loadImage(t.raw, t.high);
    } catch {
      img = null;
    }
  }
  active--;
  pump();
  if (!img) return finish(t, t.raw);
  t.img = img;
  const loaded = img;
  const doTrim = () => {
    t.trimNow = undefined;
    let url = loaded.currentSrc || loaded.src;
    try {
      url = trim(loaded) ?? url;
    } catch {
      // tainted canvas or anything else: keep the untrimmed image
    }
    finish(t, url);
  };
  if (t.high) doTrim();
  else {
    const cancel = onIdle(doTrim);
    t.trimNow = () => {
      cancel();
      doTrim();
    };
  }
}

function finish(t: Task, url: string): void {
  done.set(t.raw, url);
  t.resolve(url);
}

function pump(): void {
  while (active < MAX_ACTIVE && queue.length) {
    const i = queue.findIndex((q) => q.high);
    const t = queue.splice(i >= 0 ? i : 0, 1)[0];
    void run(t);
  }
}

/** Start (or join) loading a print; resolves to the URL to display. */
export function requestPrint(raw: string, high = false): Promise<string> {
  const known = tasks.get(raw);
  if (known) {
    if (high) bumpPrint(raw);
    return known.promise;
  }
  let resolve!: (url: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  const t: Task = { raw, high, started: false, promise, resolve };
  tasks.set(raw, t);
  queue.push(t);
  pump();
  return promise;
}

/** The finished print URL, if already available (no waiting). */
export function readyPrint(raw: string): string | undefined {
  return done.get(raw);
}

/** Its garment needs it now: load it next and trim without waiting for idle time. */
export function bumpPrint(raw: string): void {
  const t = tasks.get(raw);
  if (!t) {
    void requestPrint(raw, true);
    return;
  }
  t.high = true;
  if (t.trimNow) t.trimNow();
  else if (!t.started) pump();
}
