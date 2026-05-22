// AI-generated SEO meta descriptions for catalog_designs (dry-run).
//
// POST /functions/v1/generate-descriptions
//   body: { limit?: number }     // default 3
//
// Behavior:
//   1. Selects published catalog_designs rows where meta_description_ka is
//      NULL or empty, ORDER BY created_at DESC, LIMIT `limit`.
//   2. For each row, builds a Georgian SEO-description prompt from title_ka,
//      category, and FILTERED tags (generic site-wide tags stripped), then
//      calls the Lovable AI gateway (google/gemini-3-flash-preview).
//   3. Returns a JSON array of { slug, title_ka, generated_description,
//      char_count } per success, or { slug, error } per per-row failure.
//
// IMPORTANT: This function does NOT write to the database. Output is for
// human review only. A follow-up function (or admin UI) will persist the
// approved descriptions.
//
// Auth: verify_jwt = false (see supabase/config.toml) — invoked during
// dry-run testing from the admin's machine. Tighten before production use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";
const DEFAULT_LIMIT = 3;

// Tags applied to nearly every design — strip them so the per-design prompt
// reflects what's *unique* about each piece, not the site-wide context.
const GENERIC_TAGS = new Set([
  "sakartvelo",
  "georgia",
  "საქართველო",
  "პრინტი",
  "print",
  "მაისური",
  "tshirt",
]);

interface DesignRow {
  slug: string;
  title_ka: string;
  category: string | null;
  tags: string[] | null;
}

interface SuccessItem {
  slug: string;
  title_ka: string;
  generated_description: string;
  char_count: number;
}

interface FailureItem {
  slug: string;
  error: string;
}

type ResultItem = SuccessItem | FailureItem;

// System instruction sent on every call. Encodes the brand voice + hard
// constraints so the model output is consistent and post-editable.
const SYSTEM_PROMPT = `შენ ხარ Maika.ge-ს ქართველი SEO კოპირაიტერი. წერ მოკლე, ბუნებრივ, ხელით ნაწერი ხარისხის Georgian meta description-ებს კატალოგის დიზაინებისთვის.

წესები:
- სიგრძე: 150-158 ქართული სიმბოლო, არასოდეს გადააჭარბო 160-ს. ეს მკაცრი ლიმიტია — დათვალე სიმბოლოები სანამ პასუხს დააბრუნებ.
- ენა: მხოლოდ ქართული.
- ნუ ახსენებ ფასს — ფასები იცვლება პროდუქტისა და რაოდენობის მიხედვით.
- ნუ გამოიყენებ სიტყვას "აპარელი". თუ საჭიროა, გამოიყენე "ტექსტილი".
- ნუ ახსენებ "DTF"-ს ან ნებისმიერ ბეჭდვის ტექნოლოგიის ჟარგონს.
- ბუნებრივად ჩართე სადაც შესაბამისია: oversize მაისური/ჰუდი, რეცხვაგამძლე ეკოლოგიური საღებავი, შეკვეთიდან იმავე ან მეორე დღეს, შოურუმი Tbilisi-ში.
- იყავი უნიკალური და სპეციფიკური — გამოიყენე დიზაინის სათაური და კონკრეტული tag-ები, არ დაწერო ზოგადი ფრაზები.
- არ დაიწყო ყველა აღწერა ერთი და იგივე ფრაზით (მაგ. „სასაცილო დიზაინი"). გამოიყენე მრავალფეროვანი დასაწყისი — ზოგი დაიწყე დიზაინის სახელით, ზოგი აღწერით, ზოგი მოწოდებით.
- არ ჩასვა დიზაინის სახელი ბრჭყალებში. ჩაანაცვლე ბუნებრივად, ბრჭყალების გარეშე. არც „", არც "", არც '' — საერთოდ არ გამოიყენო ბრჭყალები ტექსტში.
- დაასრულე ბრენდით "Maika.ge" სადაც ბუნებრივად ჯდება.
- დააბრუნე მხოლოდ description-ის ტექსტი — ბრჭყალების, შესავლის, markdown-ის გარეშე.

მაგალითები მრავალფეროვანი დასაწყისის სტილებისა (გაითვალისწინე — ბრჭყალების გარეშე, თითოეული სხვა სტილით იწყება, აზრი მათი კოპირება არ არის — მთავარია, რომ შენი დასაწყისიც განსხვავებული იყოს):

[სტილი 1 — დაიწყე დიზაინის სახელით]
ფიროსმანი oversize მაისურზე — ქართული ხელოვნების იკონური დიზაინი. რეცხვაგამძლე ეკოლოგიური ბეჭდვა, შეკვეთიდან იმავე ან მეორე დღეს. Maika.ge.

[სტილი 2 — დაიწყე სცენით ან აღწერით]
ძველი თბილისის ნოსტალგიური ხედი ხარისხიან ტექსტილზე. აირჩიე oversize მაისური ან ჰუდი, მიიღე მეორე დღესვე თბილისის შოურუმიდან. Maika.ge.

[სტილი 3 — დაიწყე მოწოდებით]
შეუკვეთე უნიკალური ქართული დიზაინი oversize მაისურზე ან ჰუდიზე. რეცხვაგამძლე ეკოლოგიური ბეჭდვა, სწრაფი წარმოება. Maika.ge შოურუმი თბილისში.

[სტილი 4 — დაიწყე სამიზნე აუდიტორიით]
მუსიკის მოყვარულთათვის — გამორჩეული დიზაინი oversize მაისურზე ან ჰუდიზე. რეცხვაგამძლე ბეჭდვა, შეკვეთიდან იმავე ან მეორე დღეს. Maika.ge.`;

function filterTags(tags: string[] | null): string[] {
  if (!tags) return [];
  return tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !GENERIC_TAGS.has(t.toLowerCase()));
}

// Per-design opening-style directives, rotated by batch index. Forces variety
// across the batch even though each Gemini call is isolated and the model
// can't see what siblings wrote. Order matches the four labeled few-shot
// examples in SYSTEM_PROMPT so the model has a concrete template per style.
const OPENING_STYLES = [
  "დაიწყე აღწერა დიზაინის სახელით (სტილი 1).",
  "დაიწყე აღწერა სცენით ან დიზაინის აღწერით, არა სახელით (სტილი 2).",
  "დაიწყე აღწერა მოწოდებით — მაგ. შეუკვეთე, აირჩიე, აღმოაჩინე (სტილი 3).",
  "დაიწყე აღწერა სამიზნე აუდიტორიით — მაგ. მუსიკის მოყვარულთათვის, სპორტსმენებისთვის (სტილი 4).",
];

function buildUserPrompt(design: DesignRow, index: number): string {
  const specificTags = filterTags(design.tags);
  const openingDirective = OPENING_STYLES[index % OPENING_STYLES.length];
  const lines = [
    `სათაური: ${design.title_ka}`,
    design.category ? `კატეგორია: ${design.category}` : null,
    specificTags.length > 0 ? `Tag-ები: ${specificTags.join(", ")}` : null,
    "",
    `დასაწყისის სტილი ამ კონკრეტული აღწერისთვის: ${openingDirective}`,
    "",
    "დაწერე ერთი meta description ამ დიზაინისთვის, ზემოთ მითითებული წესების და მითითებული დასაწყისის სტილის მიხედვით.",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

// Count "user-perceived" characters (grapheme-ish) instead of UTF-16 code
// units so multi-codepoint Georgian text doesn't get over-counted.
function charCount(s: string): number {
  return [...s].length;
}

// Hard limit beyond which we trigger a one-shot "shorten" retry.
const HARD_CHAR_LIMIT = 160;
// Target we ask the retry call to hit (gives the model some headroom under 160).
const RETRY_TARGET = 158;

// Strip ALL double-quote variants (straight, curly, German low-9) anywhere
// in the body. Belt-and-suspenders for the "no quotes" rule in the prompt —
// quotes inside a meta-description tag are risky if not HTML-escaped, and
// the dry run showed the model still wrapped design names in „" and "".
function stripQuotes(s: string): string {
  return s
    .trim()
    .replace(/["“”„‟]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

async function callGateway(messages: ChatMessage[], apiKey: string): Promise<string> {
  const response = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new Error(`Rate limited by gateway (429). ${body}`);
    }
    if (response.status === 402) {
      throw new Error(`Out of credits on Lovable gateway (402). ${body}`);
    }
    throw new Error(`Gateway HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Gateway returned no text content: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return content;
}

async function generateOne(design: DesignRow, index: number, apiKey: string): Promise<string> {
  const userPrompt = buildUserPrompt(design, index);
  const firstRaw = await callGateway(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    apiKey,
  );
  const first = stripQuotes(firstRaw);

  if (charCount(first) <= HARD_CHAR_LIMIT) return first;

  // One-shot retry: continue the conversation so the model knows what to
  // shorten. Same rules still apply.
  const retryInstruction =
    `შენი წინა პასუხი ძალიან გრძელია (${charCount(first)} სიმბოლო, ლიმიტი 160). ` +
    `შეამოკლე ${RETRY_TARGET} სიმბოლომდე ან ნაკლები, ` +
    `შინაარსი და ბრენდი დატოვე იგივე. ბრჭყალები, ფასი, „აპარელი", DTF — არც ერთი. ` +
    `დააბრუნე მხოლოდ შემოკლებული ტექსტი.`;
  const retryRaw = await callGateway(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
      { role: "assistant", content: first },
      { role: "user", content: retryInstruction },
    ],
    apiKey,
  );
  const retried = stripQuotes(retryRaw);

  // If still over after retry, return it anyway — caller sees the overshoot
  // via char_count. Truncating mid-word would be worse than letting a human
  // edit it down.
  return retried;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured");
    }
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    let limit = DEFAULT_LIMIT;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0) {
          limit = Math.min(Math.floor(body.limit), 50);
        }
      } catch {
        // Empty body / non-JSON → fall back to default.
      }
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // `is.null` OR empty string. PostgREST `.or()` filter handles both.
    const { data: designs, error: queryError } = await supabase
      .from("catalog_designs")
      .select("slug, title_ka, category, tags")
      .eq("is_published", true)
      .or("meta_description_ka.is.null,meta_description_ka.eq.")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (queryError) {
      throw new Error(`Supabase query failed: ${queryError.message}`);
    }

    const rows = (designs ?? []) as DesignRow[];
    const results: ResultItem[] = [];

    // Sequential, not parallel — keeps us well under any gateway rate limit
    // during dry runs and makes per-row error reporting trivial. The index
    // also drives the opening-style rotation (see OPENING_STYLES).
    for (let i = 0; i < rows.length; i++) {
      const design = rows[i];
      try {
        const text = await generateOne(design, i, LOVABLE_API_KEY);
        results.push({
          slug: design.slug,
          title_ka: design.title_ka,
          generated_description: text,
          char_count: charCount(text),
        });
      } catch (e) {
        results.push({
          slug: design.slug,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({
        model: MODEL,
        requested_limit: limit,
        returned: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
