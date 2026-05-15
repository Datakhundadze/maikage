// Convert /public PNG and JPG images larger than 50 KB to WebP siblings.
// Originals stay in place so anything that references them by URL (canvas
// img loads, <picture> fallback) keeps working unchanged. WebP files land
// at the same path with the extension swapped (foo.png → foo.webp).
//
// Run manually after adding new images: `node scripts/convert-public-images.mjs`.
// Commit the resulting .webp files to git — they're part of the build.

import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");

const SIZE_THRESHOLD = 50 * 1024; // 50 KB
const QUALITY = 85;

async function walk(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  const files = await walk(PUBLIC_DIR);
  const candidates = files.filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.endsWith(".webp"));

  let converted = 0;
  let skippedTooSmall = 0;
  let skippedExists = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const file of candidates) {
    const info = await stat(file);
    if (info.size < SIZE_THRESHOLD) {
      skippedTooSmall++;
      continue;
    }

    // Output path: same name, .webp extension. For files with double
    // extension typos (e.g. foo.png.png) replace only the final segment.
    const webpPath = file.replace(/\.(png|jpe?g)$/i, ".webp");

    if (existsSync(webpPath)) {
      const webpInfo = await stat(webpPath);
      if (webpInfo.mtimeMs >= info.mtimeMs) {
        skippedExists++;
        continue;
      }
    }

    const input = await readFile(file);
    const output = await sharp(input).webp({ quality: QUALITY }).toBuffer();
    await writeFile(webpPath, output);

    totalBefore += info.size;
    totalAfter += output.byteLength;
    converted++;
    const rel = path.relative(ROOT, file);
    const savedPct = Math.round((1 - output.byteLength / info.size) * 100);
    console.log(`  ${rel}  ${(info.size / 1024).toFixed(0)} KB → ${(output.byteLength / 1024).toFixed(0)} KB  (-${savedPct}%)`);
  }

  console.log("\nSummary:");
  console.log(`  converted: ${converted}`);
  console.log(`  skipped (too small): ${skippedTooSmall}`);
  console.log(`  skipped (already converted): ${skippedExists}`);
  if (converted > 0) {
    const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(2);
    const savedPct = Math.round((1 - totalAfter / totalBefore) * 100);
    console.log(`  total saved: ${savedMB} MB (${savedPct}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
