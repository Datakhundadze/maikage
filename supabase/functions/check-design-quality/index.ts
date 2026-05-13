// Admin-triggered quality-gate sweep for catalog_designs.
//
// POST /functions/v1/check-design-quality
//   body: { since?: ISO timestamp }     // defaults to "today, 00:00 UTC"
//
// For each row in catalog_designs whose `created_at >= since`, the function
// HEAD-probes the print_file_url + thumbnail_url and reports:
//   - URL existence  (HTTP status of the HEAD)
//   - format         (from Content-Type)
//   - byte size      (from Content-Length)
//   - per-file pass/warn/fail against the format + size gates
//
// Dimensions / DPI / alpha channel CANNOT be checked from a HEAD response —
// those require decoding the actual pixel data. The local CLI script
// src/scripts/check-design-quality.ts uses Sharp for the full inspection;
// run it when you need those signals.
//
// Auth: this is a privileged endpoint that lists draft (unpublished)
// catalog_designs too. We gate on the caller having the `admin` role in
// public.user_roles. verify_jwt=true (set in supabase/config.toml) ensures
// the caller is at least authenticated before we run.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Same gates as the CLI script, minus the dimension/DPI/alpha checks (those
// require pixel decoding and aren't reachable via HEAD).
const PRINT_MAX_BYTES = 25 * 1024 * 1024;
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
const PRINT_ALLOWED_FORMATS = new Set(["png", "webp"]);
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

type FileKind = "print" | "thumb";
type Status = "pass" | "warn" | "fail";

interface FileProbe {
  ok: boolean;
  http: number;
  bytes: number; // 0 if unknown
  format: string; // "png" / "webp" / "jpeg" / "unknown"
  error?: string;
}

interface ReportRow {
  designId: string;
  slug: string;
  title: string;
  file: FileKind;
  url: string | null;
  http: number | null;
  dims: null; // not available via HEAD
  fmt: string;
  size: string; // "2.1MB" / "-"
  bytes: number;
  dpi: null; // not available via HEAD
  alpha: null; // not available via HEAD
  status: Status;
  notes: string[];
}

function bytesStr(n: number): string {
  if (n <= 0) return "-";
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// Maps Content-Type → short format token. Strips parameters like ; charset=…
function formatFromContentType(ct: string | null): string {
  if (!ct) return "unknown";
  const base = ct.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpeg";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return base || "unknown";
  }
}

async function head(url: string): Promise<FileProbe> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    const len = res.headers.get("content-length");
    const ct = res.headers.get("content-type");
    return {
      ok: res.ok,
      http: res.status,
      bytes: len ? Number(len) : 0,
      format: formatFromContentType(ct),
    };
  } catch (e) {
    return {
      ok: false,
      http: 0,
      bytes: 0,
      format: "unknown",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function evaluate(kind: FileKind, probe: FileProbe): {
  status: Status;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!probe.ok) {
    return {
      status: "fail",
      reasons: [probe.error ?? `HTTP ${probe.http}`],
    };
  }

  const allowed =
    kind === "print" ? PRINT_ALLOWED_FORMATS : THUMB_ALLOWED_FORMATS;
  const maxBytes = kind === "print" ? PRINT_MAX_BYTES : THUMB_MAX_BYTES;

  if (!allowed.has(probe.format)) {
    reasons.push(`format=${probe.format} (need ${[...allowed].join("/")})`);
  }
  if (probe.bytes > maxBytes) {
    reasons.push(`${bytesStr(probe.bytes)} > ${bytesStr(maxBytes)}`);
  } else if (probe.bytes === 0) {
    // Content-Length missing; some CDNs strip it. Note but don't fail.
    reasons.push("size unknown (no Content-Length)");
    return { status: "warn", reasons };
  }

  return reasons.length === 0
    ? { status: "pass", reasons: [] }
    : { status: "fail", reasons };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Caller's identity. verify_jwt=true already ensures the JWT is valid;
    // we still pull `auth.uid()` here so we can gate on the `admin` role.
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Admin check via the existing has_role(uuid, app_role) function. The
    // function is SECURITY DEFINER so we can call it through any client.
    const { data: isAdmin, error: roleErr } = await callerClient.rpc(
      "has_role",
      { _user_id: user.id, _role: "admin" },
    );
    if (roleErr || !isAdmin) {
      return new Response(
        JSON.stringify({ error: "Admin role required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Optional override; default to UTC midnight today.
    const body = await req.json().catch(() => ({}));
    let sinceIso: string;
    if (typeof body?.since === "string") {
      const parsed = new Date(body.since);
      if (Number.isNaN(parsed.getTime())) {
        return new Response(
          JSON.stringify({ error: "Invalid `since` (expected ISO timestamp)" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      sinceIso = parsed.toISOString();
    } else {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      sinceIso = start.toISOString();
    }

    // Use service role for the listing so draft rows are visible (admin
    // intent is to QC everything in the window, not just live rows).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: designs, error: listErr } = await admin
      .from("catalog_designs")
      .select(
        "id, slug, title_ka, print_file_url, thumbnail_url, is_published, created_at",
      )
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false });
    if (listErr) throw listErr;

    const rows: ReportRow[] = [];
    let pass = 0;
    let warn = 0;
    let fail = 0;

    for (const d of (designs ?? []) as CatalogDesign[]) {
      const targets: Array<{ kind: FileKind; url: string | null }> = [
        { kind: "print", url: d.print_file_url },
        { kind: "thumb", url: d.thumbnail_url },
      ];
      for (const { kind, url } of targets) {
        if (!url) {
          rows.push({
            designId: d.id,
            slug: d.slug,
            title: d.title_ka,
            file: kind,
            url: null,
            http: null,
            dims: null,
            fmt: "-",
            size: "-",
            bytes: 0,
            dpi: null,
            alpha: null,
            status: "fail",
            notes: ["url is null"],
          });
          fail++;
          continue;
        }
        const probe = await head(url);
        const ev = evaluate(kind, probe);
        if (ev.status === "pass") pass++;
        else if (ev.status === "warn") warn++;
        else fail++;
        rows.push({
          designId: d.id,
          slug: d.slug,
          title: d.title_ka,
          file: kind,
          url,
          http: probe.http,
          dims: null,
          fmt: probe.format,
          size: bytesStr(probe.bytes),
          bytes: probe.bytes,
          dpi: null,
          alpha: null,
          status: ev.status,
          notes: ev.reasons,
        });
      }
    }

    const payload = {
      since: sinceIso,
      designCount: designs?.length ?? 0,
      summary: { pass, warn, fail, total: rows.length },
      rows,
      // Tells the admin UI which gates the server actually evaluated, so
      // the table can grey out unchecked columns ("dims", "dpi", "alpha").
      gatesEvaluated: ["format", "size", "url-existence"],
      gatesSkipped: {
        dimensions: "requires pixel decode — run local CLI",
        dpi: "requires pixel decode — run local CLI",
        alpha: "requires pixel decode — run local CLI",
      },
    };

    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[check-design-quality]", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
