/// <reference types="node" />
/**
 * Quality-gate report for catalog_designs created today.
 *
 * Fetches every catalog_designs row whose `created_at >= 00:00 UTC today`,
 * downloads each row's `print_file_url` and `thumbnail_url`, inspects each
 * file with Sharp (format, width × height, byte size, DPI, alpha channel),
 * and prints a table + pass/warn/fail summary.
 *
 * Run:
 *   npm run check:designs
 *   # or directly:
 *   npx tsx src/scripts/check-design-quality.ts
 *
 * Env (with sensible fallbacks to the project's public Supabase URL/anon key):
 *   SUPABASE_URL=https://<ref>.supabase.co
 *   SUPABASE_ANON_KEY=eyJhbGciOi…
 *
 * Exit code: 0 if every file passed, 1 if anything failed, 2 on script error.
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

// ─── Quality gates ──────────────────────────────────────────────────────────
// Print file is the production-ready DTF/DTG source. The Design Standards
// doc calls for 3000×3000 minimum, 300 DPI, transparent PNG.
const PRINT_MIN_WIDTH = 3000;
const PRINT_MIN_HEIGHT = 3000;
const PRINT_RECOMMENDED_DPI = 300;
const PRINT_WARN_DPI = 150;
const PRINT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB safety cap
const PRINT_ALLOWED_FORMATS = new Set(["png", "webp"]);

// Thumbnail is the catalog grid image. Looser standards; admin's
// makeThumbnail() emits 400×400 PNG today.
const THUMB_MIN_WIDTH = 200;
const THUMB_MIN_HEIGHT = 200;
const THUMB_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const THUMB_ALLOWED_FORMATS = new Set(["png", "webp", "jpeg", "jpg"]);

interface CatalogDesign {
  id: string;
  slug: string;
  title_ka: string;
  print_file_url: string;
  thumbnail_url: string | null;
  is_published: boolean;
  created_at: string;
}

interface Inspection {
  ok: boolean;
  bytes: number;
  format: string;
  width: number | null;
  height: number | null;
  density: number | null; // DPI from EXIF/PNG metadata
  hasAlpha: boolean | null;
  error?: string;
}

type FileKind = "print" | "thumb";

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function inspect(url: string): Promise<Inspection> {
  try {
    const buf = await fetchBuffer(url);
    const meta = await sharp(buf).metadata();
    return {
      ok: true,
      bytes: buf.byteLength,
      format: meta.format ?? "unknown",
      width: meta.width ?? null,
      height: meta.height ?? null,
      density: meta.density ?? null,
      hasAlpha: meta.hasAlpha ?? null,
    };
  } catch (e: unknown) {
    return {
      ok: false,
      bytes: 0,
      format: "unknown",
      width: null,
      height: null,
      density: null,
      hasAlpha: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function bytesStr(n: number): string {
  if (n === 0) return "-";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

type Status = "pass" | "warn" | "fail";

function evaluate(kind: FileKind, r: Inspection): { status: Status; reasons: string[] } {
  if (!r.ok) return { status: "fail", reasons: [r.error ?? "fetch failed"] };
  const reasons: string[] = [];
  let warn = false;

  const allowed = kind === "print" ? PRINT_ALLOWED_FORMATS : THUMB_ALLOWED_FORMATS;
  const minW = kind === "print" ? PRINT_MIN_WIDTH : THUMB_MIN_WIDTH;
  const minH = kind === "print" ? PRINT_MIN_HEIGHT : THUMB_MIN_HEIGHT;
  const maxBytes = kind === "print" ? PRINT_MAX_BYTES : THUMB_MAX_BYTES;

  if (!allowed.has(r.format)) {
    reasons.push(`format=${r.format} (need ${[...allowed].join("/")})`);
  }
  if (r.width == null || r.height == null) {
    reasons.push("no dimensions");
  } else if (r.width < minW || r.height < minH) {
    reasons.push(`${r.width}×${r.height} (need ≥${minW}×${minH})`);
  }
  if (r.bytes > maxBytes) {
    reasons.push(`${bytesStr(r.bytes)} > ${bytesStr(maxBytes)}`);
  }
  if (kind === "print" && r.format === "png" && r.hasAlpha === false) {
    reasons.push("no alpha channel");
  }
  if (kind === "print" && r.density != null) {
    if (r.density < PRINT_WARN_DPI) {
      reasons.push(`DPI=${r.density} (need ≥${PRINT_WARN_DPI})`);
    } else if (r.density < PRINT_RECOMMENDED_DPI) {
      reasons.push(`DPI=${r.density} (recommended ≥${PRINT_RECOMMENDED_DPI})`);
      warn = true;
    }
  }

  if (reasons.length === 0) return { status: "pass", reasons: [] };
  // If the only complaints are warn-level (DPI between WARN and RECOMMENDED)
  // mark warn instead of fail.
  if (warn && reasons.length === 1) return { status: "warn", reasons };
  return { status: "fail", reasons };
}

function statusGlyph(s: Status): string {
  if (s === "pass") return "✅ pass";
  if (s === "warn") return "⚠ warn";
  return "❌ fail";
}

async function main() {
  const url =
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "https://ykoseamefoabptuijsza.supabase.co";
  const key =
    process.env.SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!key) {
    console.error(
      "Missing SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PUBLISHABLE_KEY).",
    );
    process.exit(2);
  }
  const supabase = createClient(url, key);

  // "Created today" = since 00:00 UTC today. UTC is the safest portable
  // boundary; admins running this from Tbilisi (UTC+4) will see yesterday-
  // afternoon-local rows too, which is fine for a QC pass.
  const startOfToday = new Date();
  startOfToday.setUTCHours(0, 0, 0, 0);
  const sinceIso = startOfToday.toISOString();

  const { data, error } = await supabase
    .from("catalog_designs")
    .select(
      "id, slug, title_ka, print_file_url, thumbnail_url, is_published, created_at",
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Supabase error:", error.message);
    process.exit(2);
  }

  const designs = (data ?? []) as CatalogDesign[];
  if (designs.length === 0) {
    console.log(`No catalog_designs created since ${sinceIso}.`);
    return;
  }

  console.log(
    `\nInspecting ${designs.length} design(s) created since ${sinceIso}\n`,
  );

  interface Row {
    title: string;
    file: FileKind;
    dims: string;
    fmt: string;
    size: string;
    dpi: string;
    alpha: string;
    status: string;
    notes: string;
  }
  const rows: Row[] = [];
  let pass = 0;
  let warn = 0;
  let fail = 0;

  for (const d of designs) {
    const files: Array<{ kind: FileKind; url: string | null }> = [
      { kind: "print", url: d.print_file_url },
      { kind: "thumb", url: d.thumbnail_url },
    ];
    for (const { kind, url: fileUrl } of files) {
      if (!fileUrl) {
        rows.push({
          title: d.title_ka,
          file: kind,
          dims: "-",
          fmt: "-",
          size: "-",
          dpi: "-",
          alpha: "-",
          status: "❌ fail",
          notes: "url is null",
        });
        fail++;
        continue;
      }
      const r = await inspect(fileUrl);
      const ev = evaluate(kind, r);
      if (ev.status === "pass") pass++;
      else if (ev.status === "warn") warn++;
      else fail++;
      rows.push({
        title: d.title_ka,
        file: kind,
        dims: r.width && r.height ? `${r.width}×${r.height}` : "-",
        fmt: r.format,
        size: bytesStr(r.bytes),
        dpi: r.density != null ? `${r.density}` : "-",
        alpha: r.hasAlpha === null ? "-" : r.hasAlpha ? "✓" : "✗",
        status: statusGlyph(ev.status),
        notes: ev.reasons.join("; "),
      });
    }
  }

  console.table(rows);

  console.log(
    `\nSummary: ${pass} pass • ${warn} warn • ${fail} fail • ${rows.length} files across ${designs.length} design(s)`,
  );
  if (warn > 0 || fail > 0) {
    console.log(
      "\nLegend:",
      "\n  ✅ pass — file meets all hard quality gates",
      "\n  ⚠ warn — file is shippable but below recommended (e.g. DPI 150-299 on print)",
      "\n  ❌ fail — file violates a hard gate (wrong format, too small, missing alpha, oversize, missing URL)",
    );
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Script error:", e);
  process.exit(2);
});
