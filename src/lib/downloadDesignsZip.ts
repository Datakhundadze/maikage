import { zip, type Zippable } from "fflate";

// Admin: download a set of catalog designs as one ZIP.
//
// Each design's print file is fetched (the thumbnail is the fallback when the
// print file fails), at most 6 at a time, and stored as
// `<category or "uncategorized">/<slug>.<ext>`. The zip root also gets
// manifest.csv (UTF-8 with BOM so Excel shows Georgian) and, when anything
// failed, errors.txt. Files are stored without compression (level 0): the
// images are already compressed. The archive is saved as
// maika-designs-YYYY-MM-DD.zip.

export interface ZipDesign {
  slug: string;
  title_ka: string;
  title_en: string | null;
  category: string | null;
  default_color: string | null;
  is_published: boolean;
  is_featured: boolean;
  print_file_url: string;
  thumbnail_url: string | null;
}

export interface DownloadDesignsZipResult {
  /** Designs whose image made it into the ZIP. */
  downloaded: number;
  /** Designs skipped because neither file could be fetched. */
  failed: number;
}

const MAX_CONCURRENT = 6;
const MANIFEST_COLUMNS = [
  "slug",
  "title_ka",
  "title_en",
  "category",
  "default_color",
  "is_published",
  "is_featured",
  "print_file_url",
] as const;

/** One CSV field: quoted when it contains a comma, quote or line break. */
function csvField(value: string | boolean | null): string {
  const s = value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function manifestCsv(designs: ZipDesign[]): string {
  const rows = designs.map((d) => MANIFEST_COLUMNS.map((c) => csvField(d[c])).join(","));
  return "﻿" + [MANIFEST_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

/** File extension from a URL's path (e.g. png, gif); "png" when there is none. */
function extensionOf(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // not an absolute URL: use it as is
  }
  const m = /\.([a-z0-9]{1,5})$/i.exec(path.split("/").pop() ?? "");
  return m ? m[1].toLowerCase() : "png";
}

/** A single path segment: no slashes, no leading dots, never empty. */
function safeSegment(s: string, fallback: string): string {
  const cleaned = s.replace(/[\\/]+/g, "-").replace(/^\.+/, "").trim();
  return cleaned || fallback;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// fflate's callback is typed `Uint8Array`, i.e. `Uint8Array<ArrayBufferLike>` —
// its buffer may be an ArrayBuffer or a SharedArrayBuffer. BlobPart only accepts
// a view over a plain ArrayBuffer, so the archive is narrowed to that here (the
// library always allocates a fresh ArrayBuffer for its output). No copy, no
// runtime change — the view is handed to Blob unchanged.
function zipAsync(files: Zippable): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) =>
      err ? reject(err) : resolve(data as Uint8Array<ArrayBuffer>),
    );
  });
}

function saveBlob(data: Uint8Array<ArrayBuffer>, filename: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the browser a moment to start the download before releasing the blob
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadDesignsZip(
  designs: ZipDesign[],
  onProgress?: (done: number, total: number) => void,
): Promise<DownloadDesignsZipResult> {
  const total = designs.length;
  const encoder = new TextEncoder();
  const files: Zippable = {};
  const usedPaths = new Set<string>();
  const errors: string[] = [];
  let done = 0;
  let next = 0;
  onProgress?.(0, total);

  const fetchOne = async (d: ZipDesign) => {
    let bytes: Uint8Array | null = null;
    let usedUrl = d.print_file_url;
    let reason = "";
    try {
      bytes = await fetchBytes(d.print_file_url);
    } catch (e) {
      reason = `print: ${e instanceof Error ? e.message : String(e)}`;
      if (d.thumbnail_url && d.thumbnail_url !== d.print_file_url) {
        try {
          bytes = await fetchBytes(d.thumbnail_url);
          usedUrl = d.thumbnail_url;
        } catch (e2) {
          reason += `; thumbnail: ${e2 instanceof Error ? e2.message : String(e2)}`;
        }
      }
    }
    if (bytes) {
      const folder = safeSegment(d.category ?? "", "uncategorized");
      const base = `${folder}/${safeSegment(d.slug, "design")}`;
      const ext = extensionOf(usedUrl);
      let path = `${base}.${ext}`;
      for (let n = 2; usedPaths.has(path); n++) path = `${base}-${n}.${ext}`;
      usedPaths.add(path);
      files[path] = bytes;
    } else {
      errors.push(`${d.slug}\t${d.print_file_url}\t${reason}`);
    }
    done++;
    onProgress?.(done, total);
  };

  const worker = async () => {
    while (next < designs.length) await fetchOne(designs[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT, designs.length) }, worker));

  files["manifest.csv"] = encoder.encode(manifestCsv(designs));
  if (errors.length > 0) {
    files["errors.txt"] = encoder.encode(["slug\tprint_file_url\terror", ...errors].join("\n") + "\n");
  }
  saveBlob(await zipAsync(files), `maika-designs-${todayStamp()}.zip`);
  return { downloaded: total - errors.length, failed: errors.length };
}
