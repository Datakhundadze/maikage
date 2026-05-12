// Shared helpers for catalog design upload flows. Extracted so the bulk
// upload dialog can reuse the exact slug logic, thumbnail generator, and
// slug regex without duplicating them. Behavior is byte-identical to the
// originals that used to live inside DesignUploadDialog.tsx.

const KA_TO_LAT: Record<string, string> = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z",
  "თ": "t", "ი": "i", "კ": "k", "ლ": "l", "მ": "m", "ნ": "n", "ო": "o",
  "პ": "p", "ჟ": "zh", "რ": "r", "ს": "s", "ტ": "t", "უ": "u", "ფ": "p",
  "ქ": "k", "ღ": "gh", "ყ": "q", "შ": "sh", "ჩ": "ch", "ც": "ts", "ძ": "dz",
  "წ": "ts", "ჭ": "ch", "ხ": "kh", "ჯ": "j", "ჰ": "h",
};

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyTitle(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    const mapped = KA_TO_LAT[ch];
    if (mapped) out += mapped;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export async function makeThumbnail(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const SIZE = 400;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  const ratio = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * ratio;
  const h = img.naturalHeight * ratio;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))),
      "image/png",
    );
  });
}
