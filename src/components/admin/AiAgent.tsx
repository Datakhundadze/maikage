import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  runWithConcurrency,
  makeThumbnail,
  slugifyTitle,
} from "@/components/admin/catalog/designUploadHelpers";
import { runTransparencyPipeline } from "@/lib/generation";
import { CATEGORIES, type CategorySlug } from "@/lib/categories";
import { Sparkles, Check, X, AlertCircle, Loader2, Save, AlertTriangle } from "lucide-react";

// ---- THEMES → CATALOG CATEGORIES (1:1) --------------------------------
//
// One theme button per catalog category slug (see src/lib/categories.ts).
// theme.key IS the catalog category slug — on save we use it directly,
// so the agent's output lands in the catalog row with the right category
// with zero translation. Custom-text prompts fall back to "various".
//
// Copyright guards come in three tiers:
//   GUARD_BASE     — applied to every prompt
//   GUARD_IP       — extra-strict for music/movies/sports (highest IP risk)
//   GUARD_KA       — extra-strict for georgian/patriotic/georgian-table
//                    (Georgian cultural categories — temptation to copy real
//                    artists / public figures / institutional emblems)
//
// Language: georgian / patriotic / georgian-table prompts ask for Georgian
// text where text applies. All other categories use English copy.

interface ThemeDef {
  /** key === catalog category slug, so category-on-save is the slug directly. */
  key: CategorySlug;
  label: string;
  /** Returns the character prompt for variation index `i`. The variation
   *  hint is appended so a batch of N designs from the same theme isn't
   *  N identical outputs. */
  buildPrompt: (variationHint: string) => string;
  /** True for themes whose prompt inherently asks for a slogan/typography.
   *  Without this the `text` param stayed empty and gemini-proxy emitted its
   *  "DO NOT include any text" instruction — contradicting the theme's own
   *  wording. When set (and no custom quoted slogan is given), a short generic
   *  hint is sent as `text` so the proxy emits its TYPOGRAPHY instruction
   *  instead. Additive only — no theme prompt text was changed. */
  wantsText?: true;
}

// Generic slogan hint used for wantsText themes when the admin supplied no
// quoted phrase. Intentionally vague: the model invents the wording (the batch
// is curated before publishing), we only need the proxy to allow typography.
const THEME_TEXT_HINT = "short original slogan";

const GUARD_BASE =
  "no real brands, no real logos, no real or famous people, " +
  "no movie/TV/anime/cartoon characters, no band or musician names, " +
  "no sports teams or franchises, no copyrighted phrases or slogans";

const GUARD_IP =
  "absolutely NO real bands, artists, albums, song titles, movie titles, " +
  "film characters, actors, athletes, team names, jerseys, or logos — " +
  "only generic aesthetic motifs";

const GUARD_KA =
  "original Georgian-inspired motifs only, " +
  "NO reproductions of any specific artist's work (e.g. no Pirosmani-style copies), " +
  "no real Georgian public figures, no real logos or emblems, " +
  "original ornamental/cultural/typographic design only";

// Anti-garment guard. Gemini will occasionally render the design composited
// onto a folded t-shirt / hanger / product photo instead of as standalone
// artwork — particularly when our character prompt contains the phrase
// "t-shirt design" (which can read to the model as a literal instruction
// to draw a t-shirt). The customer studio's gemini-proxy system prompt
// already forbids garments, but Gemini is non-deterministic; appending
// this reminder to OUR character prompt reinforces the constraint and
// substantially reduces the failure rate. The wording is from the
// task spec and is the same on EVERY prompt — theme or custom-text.
const GUARD_NO_GARMENT =
  "Output ONLY the standalone design artwork itself on a plain solid " +
  "white background. Do NOT draw or include any t-shirt, hoodie, garment, " +
  "apparel, clothing, fabric, mockup, folded shirt, hanger, or product of " +
  "any kind. No clothing item, no product photo, no shirt — just the " +
  "isolated graphic artwork, centered, ready to be printed.";

// Anti-backdrop guard — the sibling of GUARD_NO_GARMENT for NON-garment
// surfaces. Gemini sometimes renders the design as if printed/mounted on a
// card, sheet of paper, poster, or object instead of as raw isolated artwork.
// Appended UNCONDITIONALLY to every agent prompt (adapts the Studio
// GUARD_SLOGAN_NO_CARD, extended from text to the whole artwork). Client-side
// only — the shared gemini-proxy prompt stays untouched.
const GUARD_NO_BACKDROP =
  "CRITICAL: output the artwork ITSELF as isolated standalone graphics on an " +
  "empty plain background — do NOT depict the design printed, mounted, framed, " +
  "or placed on any physical object or surface. No paper, sheet, card, poster, " +
  "sign, banner, sticker, sticker sheet, label, note, mug, frame, canvas, " +
  "book, box, or rectangular backdrop behind or under the artwork, and nothing " +
  "holding or displaying it — just the raw design floating on empty background.";

// A quoted phrase in a CUSTOM prompt is the slogan to render AS typography —
// same convention (and regex) as the customer Studio: straight, curly, Georgian
// („…") and guillemet quotes. Without quotes the text param stays empty and the
// proxy's default "no text" instruction applies, exactly as before.
const SLOGAN_RE = /[«"„“”'`]([^«»"„“”'`]{2,120})[»"“”'`]/;

// Appended when a slogan IS present (mirrors the Studio guard): keeps the
// lettering as standalone graphics instead of sitting on a card/paper/poster.
const GUARD_SLOGAN_NO_CARD =
  "Render any text as bold STANDALONE typography/lettering floating directly " +
  "on the plain background — NOT placed on a paper, card, poster, sign, banner, " +
  "sticker, label, note, frame, or any rectangular backdrop surface. No sheet " +
  "of paper, no card, no poster behind the text — just the letters as isolated " +
  "graphic artwork.";

// Labels lifted from CATEGORIES (src/lib/categories.ts). Stored here so
// the button text matches what admin sees in the catalog dropdown exactly.
const LABEL: Record<CategorySlug, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.label_ka]),
) as Record<CategorySlug, string>;

const THEMES: ThemeDef[] = [
  // --- Georgian-cultural categories (GUARD_KA appended) -----------------
  {
    key: "georgian", label: LABEL.georgian, wantsText: true,
    buildPrompt: (v) =>
      `original Georgian-themed design with traditional ornaments, Mkhedruli/Asomtavruli typography or culturally-inspired motifs, Georgian-language text where text applies, ${v}, transparent background. ${GUARD_BASE}. ${GUARD_KA}`,
  },
  {
    key: "patriotic", label: LABEL.patriotic, wantsText: true,
    buildPrompt: (v) =>
      `original Georgian patriotic design — generic national-pride aesthetic with traditional ornaments or symbolic motifs (no real flags reproduced verbatim, no institutional emblems), Georgian-language slogan where text applies, ${v}, transparent background. ${GUARD_BASE}. ${GUARD_KA}`,
  },
  {
    key: "georgian-table", label: LABEL["georgian-table"], wantsText: true,
    buildPrompt: (v) =>
      `original Georgian supra (feast) themed design — khinkali, khachapuri, qvevri, vine, toasting cup or similar food/wine motifs, Georgian-language text where text applies, ${v}, transparent background. ${GUARD_BASE}. ${GUARD_KA}`,
  },

  // --- IP-sensitive categories (GUARD_IP appended) ----------------------
  {
    key: "music", label: LABEL.music,
    buildPrompt: (v) =>
      `original music-themed design — vinyl records, headphones, sound waves, generic anonymous instruments, abstract concert vibes — ${v}, transparent background. ${GUARD_BASE}. ${GUARD_IP}`,
  },
  {
    key: "movies", label: LABEL.movies,
    buildPrompt: (v) =>
      `original cinema-themed design — film reel, clapperboard, generic camera, popcorn, abstract movie aesthetic — ${v}, transparent background. ${GUARD_BASE}. ${GUARD_IP}`,
  },
  {
    key: "sports", label: LABEL.sports,
    buildPrompt: (v) =>
      `original sports-themed design — generic equipment (balls, racquets, weights, sneakers), abstract action lines, anonymous athletic silhouettes — ${v}, transparent background. ${GUARD_BASE}. ${GUARD_IP}`,
  },

  // --- Standard categories (GUARD_BASE only) ----------------------------
  {
    key: "humor", label: LABEL.humor, wantsText: true,
    buildPrompt: (v) =>
      `original funny English slogan typography t-shirt design, witty original humor, bold lettering, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "couples", label: LABEL.couples, wantsText: true,
    buildPrompt: (v) =>
      `original couple / love themed design — hearts, romantic motifs, original English slogan where text applies, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "art", label: LABEL.art,
    buildPrompt: (v) =>
      `original abstract artistic design, painterly or expressive composition, original aesthetic, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "animals", label: LABEL.animals,
    buildPrompt: (v) =>
      `original animal illustration — cute or stylized original animal subject, hand-drawn style, ${v}, transparent background. ${GUARD_BASE}, no named or franchise characters`,
  },
  {
    key: "auto-moto", label: LABEL["auto-moto"],
    buildPrompt: (v) =>
      `original car or motorcycle themed design — generic vehicles only (no real brand grilles, badges, or logos), abstract automotive aesthetic, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "professions", label: LABEL.professions, wantsText: true,
    buildPrompt: (v) =>
      `original profession / occupation themed design — generic profession motifs (e.g. stethoscope, paintbrush, wrench, laptop), original English slogan where text applies, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "seasonal", label: LABEL.seasonal,
    buildPrompt: (v) =>
      `original seasonal themed design — generic holiday or season motifs (winter, spring, summer, autumn), no real holiday brand mascots or specific commercial holiday characters, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "travel", label: LABEL.travel, wantsText: true,
    buildPrompt: (v) =>
      `original travel / wanderlust themed design — generic motifs (airplane, suitcase, compass, mountains, map, globe, generic landmarks with no real brand logos), original English slogan where text applies, ${v}, transparent background. ${GUARD_BASE}`,
  },
  {
    key: "various", label: LABEL.various,
    buildPrompt: (v) =>
      `original creative t-shirt design — minimalist or expressive aesthetic, original subject of your choice, ${v}, transparent background. ${GUARD_BASE}`,
  },
];

// Visual grouping for the UI only — not used for category mapping.
// Each button still maps 1:1 to its catalog slug; this just lets the
// admin see at a glance which categories carry the extra-strict guards.
const THEME_DISPLAY_GROUPS: { heading: string; keys: CategorySlug[] }[] = [
  { heading: "ქართული თემები", keys: ["georgian", "patriotic", "georgian-table"] },
  { heading: "IP-მგრძნობიარე", keys: ["music", "movies", "sports"] },
  { heading: "სხვა კატეგორიები", keys: ["humor", "couples", "art", "animals", "auto-moto", "professions", "seasonal", "travel", "various"] },
];

// ---- STYLES ------------------------------------------------------------
//
// Visual style is orthogonal to theme. The selected style's `phrase` is
// appended to every generated prompt (after the copyright guard) AND is
// passed to gemini-proxy as the `style` param + `isRealistic` flag, so
// the proxy can also route to the realistic model when appropriate
// (see customer studio src/lib/generation.ts:421-438).
//
// NO trademarked studio names in any phrase. "Anime/manga" and "3D
// animated movie" are generic art-style descriptors; we never reference
// Pixar / Disney / Ghibli / specific titles or characters.

interface StyleDef {
  key: string;
  label: string;
  phrase: string;
  isRealistic: boolean;
}

const STYLES: StyleDef[] = [
  {
    key: "sticker",
    label: "სტიკერი",
    phrase: "bold cartoon sticker style, thick clean outlines, vivid flat colors",
    isRealistic: false,
  },
  {
    key: "realistic",
    label: "რეალისტური",
    phrase: "photorealistic rendering, realistic detail and texture, natural lighting",
    isRealistic: true,
  },
  {
    key: "anime",
    label: "ანიმე",
    phrase: "anime/manga art style, expressive line work, dynamic shading",
    isRealistic: false,
  },
  {
    key: "3d-cartoon",
    label: "3D კარტუნი",
    phrase: "stylized 3D animated movie style, smooth 3D render, soft cinematic shading",
    isRealistic: false,
  },
  {
    key: "flat-vector",
    label: "ფლეტ ვექტორი",
    phrase: "flat vector illustration style, clean geometric shapes, solid colors, minimal gradients",
    isRealistic: false,
  },
  {
    key: "watercolor",
    label: "აკვარელი",
    phrase: "watercolor painting style, soft color washes, gentle paper texture, hand-painted feel",
    isRealistic: false,
  },
];

const DEFAULT_STYLE_KEY = "sticker";

// Variation hints rotated by slot index so a batch of N from one theme
// doesn't return N identical compositions. Keep terse — these append to
// the prompt and over-specifying would fight the theme.
const VARIATION_HINTS = [
  "minimalist",
  "bold contrast",
  "vibrant colors",
  "muted earthy palette",
  "modern clean style",
  "textured rough finish",
  "playful composition",
  "sleek elegant",
  "high-contrast monochrome",
  "warm tones",
];

const COUNT_OPTIONS = [3, 5, 10] as const;
type CountChoice = (typeof COUNT_OPTIONS)[number];

interface Slot {
  id: string;
  index: number;
  status: "pending" | "loading" | "done" | "error";
  themeLabel: string;
  /** Captured at slot-build time. themeKey is a catalog CategorySlug
   *  when a theme button was selected, or "custom" for free-text prompts.
   *  Save uses this directly as the catalog_designs.category column
   *  (with "custom" mapped to "various"). */
  themeKey: string;
  /** Quoted phrase from a custom prompt → sent as the `text` param so the
   *  proxy renders it as typography. "" for theme prompts / no quotes. */
  slogan: string;
  styleKey: string;
  prompt: string;
  /** Captured at slot-build time so the worker uses the style chosen at
   *  generation start, not whatever the admin happens to have selected
   *  later (avoids race with re-runs). */
  stylePhrase: string;
  isRealistic: boolean;
  imageDataUrl?: string;
  error?: string;
  accepted: boolean;
  /** Save sub-state. `null` once the slot has never been saved. */
  saveStatus: null | "transparency" | "uploading" | "saved" | "save-error";
  savedDesignId?: string;
  saveError?: string;
  /** True if the transparency pipeline fell back to white-bg removal.
   *  Surfaced as a small warning so admin verifies the print file. */
  usedFallback?: boolean;
}

const BRAND_GREEN = "#26BB89";
const CONCURRENCY = 3;

function buildPromptForTheme(
  theme: ThemeDef | null,
  custom: string,
  style: StyleDef,
  index: number,
): { themeLabel: string; prompt: string; slogan: string } {
  const variation = VARIATION_HINTS[index % VARIATION_HINTS.length];
  // Suffix appended to every prompt: anti-garment guard first (universal),
  // then the style cue. The style phrase is ALSO sent to gemini-proxy as
  // the structured `style` param (see the invoke call).
  const stylePhrase = ` ${style.phrase}.`;
  const noGarment = ` ${GUARD_NO_GARMENT}`;
  // Universal anti-backdrop guard — appended to BOTH the theme and custom
  // paths so no agent generation renders on a card/paper/poster/object.
  const noBackdrop = ` ${GUARD_NO_BACKDROP}`;
  // Theme path. Themes flagged wantsText inherently ask for a slogan, so send
  // the generic hint as `text` (→ proxy emits TYPOGRAPHY, not "no text") and
  // append the anti-card guard like the custom path. Unflagged themes keep
  // slogan: "" — byte-identical to before.
  if (theme) {
    const themeSlogan = theme.wantsText ? THEME_TEXT_HINT : "";
    const themeSloganGuard = themeSlogan ? ` ${GUARD_SLOGAN_NO_CARD}` : "";
    return {
      themeLabel: theme.label,
      prompt: theme.buildPrompt(variation) + noGarment + noBackdrop + themeSloganGuard + stylePhrase,
      slogan: themeSlogan,
    };
  }
  // Custom prompt path — wrap with the base copyright guard since we
  // don't know the cultural context. The previous version of this line
  // referenced the renamed COPYRIGHT_GUARD_EN constant and silently
  // injected the literal word "undefined" into every custom prompt
  // (tsconfig has strict:false so undefined references compile). It
  // also began with "original t-shirt design: ${trimmed}" — that
  // phrasing reads to Gemini as "draw a t-shirt with this subject"
  // and was likely the dominant cause of the folded-shirt failures.
  const trimmed = custom.trim();
  // Quoted phrase → rendered as typography via the `text` param (see the
  // invoke call); the anti-card guard rides along only when one is present.
  const slogan = trimmed.match(SLOGAN_RE)?.[1]?.trim() ?? "";
  const sloganGuard = slogan ? ` ${GUARD_SLOGAN_NO_CARD}` : "";
  return {
    themeLabel: trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed,
    prompt: `original design — ${trimmed}, ${variation}. ${GUARD_BASE}.${noGarment}${noBackdrop}${sloganGuard}${stylePhrase}`,
    slogan,
  };
}

// Themes map 1:1 to catalog category slugs (theme.key IS the slug), so
// category-on-save is simply the slot's themeKey. Custom-text prompts
// pass "custom" as the key and fall back to "various". Admin can
// recategorize later from the catalog grid.
const VALID_SLUGS: Set<string> = new Set(CATEGORIES.map((c) => c.slug));

function categoryForSlot(themeKey: string): CategorySlug {
  return VALID_SLUGS.has(themeKey) ? (themeKey as CategorySlug) : "various";
}

// Slug = slugified theme label + a short base36 timestamp + slot index.
// The timestamp avoids cross-batch collisions; the index avoids
// within-batch collisions for repeated themes. If the DB still rejects
// (race with another admin), the save flow catches the 23505 unique
// violation and retries once with a fresh timestamp.
function buildSlug(themeLabel: string, index: number, retryNonce?: string): string {
  const base = slugifyTitle(themeLabel) || "ai-design";
  const ts = (retryNonce ?? Date.now().toString(36)).slice(-4);
  return `${base}-${ts}-${index}`.slice(0, 60);
}

interface ProductOption {
  id: string;
  type: string;
}

export default function AiAgent() {
  const { toast } = useToast();
  const [selectedThemeKey, setSelectedThemeKey] = useState<string | null>(null);
  const [customTheme, setCustomTheme] = useState<string>("");
  const [selectedStyleKey, setSelectedStyleKey] = useState<string>(DEFAULT_STYLE_KEY);
  const [count, setCount] = useState<CountChoice>(5);
  const [generating, setGenerating] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Set when the admin clicks "Stop"; checked between slot completions to
  // halt the batch early. Cleared on every new Generate.
  const abortFlag = useRef(false);

  // Pre-fetched products so the save flow can set default_product_id
  // (mirrors DesignUploadDialog.tsx — first T-Shirt is the default).
  const [defaultProductId, setDefaultProductId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors existing admin pattern (DesignUploadDialog) where the generated Database type lags the schema
    (supabase as any)
      .from("products")
      .select("id, type")
      .eq("is_active", true)
      .then(({ data }: { data: ProductOption[] | null }) => {
        if (cancelled || !data) return;
        const firstTshirt = data.find((p) => p.type === "T-Shirt");
        setDefaultProductId(firstTshirt?.id ?? data[0]?.id ?? "");
      });
    return () => { cancelled = true; };
  }, []);

  // Theme lookup by category slug — used to render visual groups by
  // iterating THEME_DISPLAY_GROUPS and pulling each slug's definition.
  const themeByKey = useMemo(() => {
    const m = new Map<CategorySlug, ThemeDef>();
    for (const t of THEMES) m.set(t.key, t);
    return m;
  }, []);

  const selectedTheme = useMemo(
    () => THEMES.find((t) => t.key === selectedThemeKey) ?? null,
    [selectedThemeKey],
  );

  const selectedStyle = useMemo(
    () => STYLES.find((s) => s.key === selectedStyleKey) ?? STYLES[0],
    [selectedStyleKey],
  );

  const canGenerate =
    !generating && (selectedTheme !== null || customTheme.trim().length > 0);

  const acceptedCount = slots.filter((s) => s.accepted && s.status === "done").length;
  // Accepted designs that haven't been saved yet — the count shown on the
  // batch save button. Once saved, slots stay in the grid as a "saved ✓"
  // indicator (saveStatus === "saved") and don't re-count here.
  const savableCount = slots.filter(
    (s) => s.accepted && s.status === "done" && s.saveStatus !== "saved",
  ).length;
  const savedCount = slots.filter((s) => s.saveStatus === "saved").length;
  const hasAnyDone = slots.some((s) => s.status === "done");
  // defaultProductId is intentionally NOT in this gate — we surface the
  // button regardless so admin sees the save flow exists; if products
  // haven't loaded by the time they click, handleSaveBatch toasts a clear
  // error instead of silently disabling.
  const canSave = !saving && !generating && savableCount > 0;

  function pickTheme(key: string) {
    setSelectedThemeKey(key);
    setCustomTheme("");
  }

  function clearTheme() {
    setSelectedThemeKey(null);
  }

  async function handleGenerate() {
    if (!canGenerate) return;
    abortFlag.current = false;
    setGenerating(true);

    const initialSlots: Slot[] = Array.from({ length: count }, (_, i) => {
      const { themeLabel, prompt, slogan } = buildPromptForTheme(selectedTheme, customTheme, selectedStyle, i);
      return {
        id: `${Date.now()}-${i}`,
        index: i,
        status: "pending",
        themeLabel,
        themeKey: selectedTheme?.key ?? "custom",
        slogan,
        styleKey: selectedStyle.key,
        prompt,
        stylePhrase: selectedStyle.phrase,
        isRealistic: selectedStyle.isRealistic,
        accepted: false,
        saveStatus: null,
      };
    });
    setSlots(initialSlots);

    const setSlot = (i: number, patch: Partial<Slot>) =>
      setSlots((prev) => prev.map((s) => (s.index === i ? { ...s, ...patch } : s)));

    await runWithConcurrency(initialSlots, CONCURRENCY, async (slot) => {
      if (abortFlag.current) {
        setSlot(slot.index, { status: "error", error: "Stopped" });
        return;
      }
      setSlot(slot.index, { status: "loading" });
      try {
        // Mirror src/lib/generation.ts:432-438 — same edge function (gemini-proxy),
        // same action ("generate-design"), same params shape (DesignParams fields
        // flattened with product/color/speed/isRealistic). DesignParams that don't
        // apply to a theme-only generation are intentionally empty strings / nulls.
        const { data, error } = await supabase.functions.invoke("gemini-proxy", {
          body: {
            action: "generate-design",
            params: {
              character: slot.prompt,
              characterImages: [],
              scene: "",
              sceneImage: null,
              // Pass the style phrase as the structured `style` param too,
              // not only inside the character prompt — mirrors the customer
              // studio (src/lib/generation.ts:432-438) so gemini-proxy can
              // apply its style-aware prompt building and realistic-model
              // routing. isRealistic is the explicit flag.
              style: slot.stylePhrase,
              styleImage: null,
              // Quoted slogan from a custom prompt (empty otherwise → the
              // proxy keeps its default "no text" instruction).
              text: slot.slogan,
              textImage: null,
              product: "T-Shirt",
              color: "White",
              // Cost: "fast" routes non-realistic batches to the cheaper
              // gemini-2.5-flash-image in gemini-proxy (only "fast" maps to
              // flash there). These are internal previews we curate before
              // publishing. Realistic themes stay on "pro" — flash skews
              // illustrative and would break photoreal output.
              speed: slot.isRealistic ? "pro" : "fast",
              isRealistic: slot.isRealistic,
            },
          },
        });
        if (error) {
          let detail: string = error.message || "AI request failed";
          try {
            // Lovable gateway returns the human-readable error in context.json()
            const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
            if (ctx?.json) {
              const body = await ctx.json();
              if (body?.error) detail = body.error;
            }
          } catch { /* keep error.message */ }
          throw new Error(detail);
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.image) throw new Error("No image returned");
        setSlot(slot.index, { status: "done", imageDataUrl: data.image });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSlot(slot.index, { status: "error", error: msg });
      }
    });

    setGenerating(false);
    abortFlag.current = false;
  }

  function handleStop() {
    abortFlag.current = true;
    toast({ title: "გენერაცია გაჩერდება მიმდინარე სლოტების შემდეგ" });
  }

  function toggleAccept(index: number) {
    setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, accepted: !s.accepted } : s)));
  }

  function rejectSlot(index: number) {
    setSlots((prev) => prev.map((s) => (s.index === index ? { ...s, accepted: false, status: "error", error: "უარყოფილია" } : s)));
  }

  async function handleSaveBatch() {
    if (!canSave) return;
    if (!defaultProductId) {
      toast({
        title: "პროდუქტის ჩატვირთვა ვერ მოხერხდა",
        description: "გადატვირთე გვერდი და სცადე თავიდან.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    const setSlot = (i: number, patch: Partial<Slot>) =>
      setSlots((prev) => prev.map((s) => (s.index === i ? { ...s, ...patch } : s)));

    const toSave = slots.filter(
      (s) => s.accepted && s.status === "done" && s.saveStatus !== "saved" && s.imageDataUrl,
    );

    await runWithConcurrency(toSave, CONCURRENCY, async (slot) => {
      try {
        // (1) Transparency — reuse the same pipeline the customer studio uses.
        setSlot(slot.index, { saveStatus: "transparency", saveError: undefined });
        const { transparentImage, usedFallback } = await runTransparencyPipeline(
          slot.imageDataUrl!,
          { isRealistic: slot.isRealistic },
        );

        // (2) Convert the transparent data URL to a Blob/File for upload +
        //     thumbnail. The Blob is uploaded as the print file directly;
        //     the same File is fed to makeThumbnail.
        setSlot(slot.index, { saveStatus: "uploading", usedFallback });
        const printBlob = await (await fetch(transparentImage)).blob();
        const printFile = new File([printBlob], `${slot.id}.png`, { type: "image/png" });
        const thumbBlob = await makeThumbnail(printFile);

        // (3) Upload print + thumbnail to the catalog-designs bucket.
        //     Insert the row. On a 23505 (unique slug) violation, retry
        //     once with a fresh timestamp suffix.
        const category = categoryForSlot(slot.themeKey);
        const tags = ["ai-generated", slot.themeKey, slot.styleKey];
        const aiPrompt = `${slot.themeLabel} | ${slot.stylePhrase} | variation ${slot.index}`;
        const titleKa = `${slot.themeLabel} #${slot.index + 1}`;

        const tryInsert = async (slug: string): Promise<{ designId: string | null; conflict: boolean; otherError?: string }> => {
          const ts = Date.now();
          const printPath = `prints/${slug}-${ts}.png`;
          const { error: upErr } = await supabase.storage
            .from("catalog-designs")
            .upload(printPath, printBlob, { contentType: "image/png", upsert: false });
          if (upErr) return { designId: null, conflict: false, otherError: `print upload: ${upErr.message}` };
          const printUrl = supabase.storage.from("catalog-designs").getPublicUrl(printPath).data.publicUrl;

          const thumbPath = `thumbnails/${slug}-${ts}.png`;
          const { error: thErr } = await supabase.storage
            .from("catalog-designs")
            .upload(thumbPath, thumbBlob, { contentType: "image/png", upsert: false });
          if (thErr) return { designId: null, conflict: false, otherError: `thumb upload: ${thErr.message}` };
          const thumbUrl = supabase.storage.from("catalog-designs").getPublicUrl(thumbPath).data.publicUrl;

          const designId = crypto.randomUUID();
          // (supabase as any) cast mirrors the existing admin upload pattern —
          // the generated Database type lags behind the schema and this insert
          // shape exactly matches BulkDesignUploadDialog.tsx:208-222 with the
          // two AI-specific fields appended.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: insErr } = await (supabase as any)
            .from("catalog_designs")
            .insert({
              id: designId,
              slug,
              title_ka: titleKa,
              title_en: null,
              description_ka: null,
              category,
              tags,
              print_file_url: printUrl,
              thumbnail_url: thumbUrl,
              default_product_id: defaultProductId,
              is_published: false,
              ai_generated: true,
              ai_prompt: aiPrompt,
            });
          if (insErr) {
            // Postgres unique violation = 23505. PostgREST surfaces it on
            // the error code field; the supabase-js error also exposes it.
            const code = (insErr as { code?: string }).code;
            const isConflict = code === "23505" || insErr.message?.toLowerCase().includes("duplicate key");
            return { designId: null, conflict: !!isConflict, otherError: isConflict ? undefined : insErr.message };
          }
          return { designId, conflict: false };
        };

        let slug = buildSlug(slot.themeLabel, slot.index);
        let result = await tryInsert(slug);
        if (result.conflict) {
          // One-shot retry with a fresh timestamp suffix — covers the rare
          // race where another admin's save landed the same slug between
          // our buildSlug() and the insert.
          slug = buildSlug(slot.themeLabel, slot.index, Date.now().toString(36) + Math.random().toString(36).slice(2, 4));
          result = await tryInsert(slug);
        }

        if (!result.designId) {
          throw new Error(result.otherError || "save failed (unique slug conflict after retry)");
        }
        setSlot(slot.index, { saveStatus: "saved", savedDesignId: result.designId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSlot(slot.index, { saveStatus: "save-error", saveError: msg });
      }
    });

    setSaving(false);
    const stillFailed = slots.filter((s) => s.saveStatus === "save-error").length;
    toast({
      title: stillFailed > 0
        ? `შენახული: ${savedCount + toSave.length - stillFailed}, შეცდომა: ${stillFailed}`
        : `${toSave.length} დიზაინი შენახულია კატალოგში`,
      variant: stillFailed > 0 ? "destructive" : "default",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: BRAND_GREEN }} />
            AI აგენტი
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            აირჩიე თემა, დააგენერირე დიზაინები, მონიშნე საუკეთესოები და შეინახე კატალოგში დრაფტებად.
          </p>
        </div>
        {slots.length > 0 && (
          <div className="text-xs text-muted-foreground">
            მონიშნული: <span className="font-semibold" style={{ color: BRAND_GREEN }}>{acceptedCount}</span> / {slots.filter((s) => s.status === "done").length}
            {savedCount > 0 && (
              <>
                {" · "}შენახული: <span className="font-semibold" style={{ color: BRAND_GREEN }}>{savedCount}</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Theme buttons — one per catalog category (1:1 mapping) */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        {THEME_DISPLAY_GROUPS.map((group) => (
          <div key={group.heading}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
              {group.heading}
            </h3>
            <div className="flex flex-wrap gap-2">
              {group.keys.map((key) => {
                const theme = themeByKey.get(key);
                if (!theme) return null;
                const active = selectedThemeKey === theme.key;
                return (
                  <button
                    key={theme.key}
                    type="button"
                    onClick={() => pickTheme(theme.key)}
                    disabled={generating}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      active
                        ? "text-white"
                        : "border-border hover:border-muted-foreground text-foreground"
                    }`}
                    style={active ? { backgroundColor: BRAND_GREEN, borderColor: BRAND_GREEN } : undefined}
                  >
                    {theme.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Custom theme */}
        <div className="pt-2 border-t border-border">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
            CUSTOM
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="ან ჩაწერე საკუთარი თემა (ინგლისურად)…"
              value={customTheme}
              onChange={(e) => {
                setCustomTheme(e.target.value);
                if (e.target.value.length > 0) clearTheme();
              }}
              disabled={generating}
              className="flex-1"
            />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            წარწერისთვის ჩასვი ბრჭყალებში: „მობი" — ბრჭყალების გარეშე ტექსტი არ დაიბეჭდება.
          </p>
        </div>
      </div>

      {/* Style picker */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          STYLE
        </h3>
        <div className="flex flex-wrap gap-2">
          {STYLES.map((style) => {
            const active = selectedStyleKey === style.key;
            return (
              <button
                key={style.key}
                type="button"
                onClick={() => setSelectedStyleKey(style.key)}
                disabled={generating}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  active
                    ? "text-white"
                    : "border-border hover:border-muted-foreground text-foreground"
                }`}
                style={active ? { backgroundColor: BRAND_GREEN, borderColor: BRAND_GREEN } : undefined}
                title={style.phrase}
              >
                {style.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action row: count + generate */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">რაოდენობა:</span>
          {COUNT_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              disabled={generating}
              className={`h-8 w-10 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                count === n
                  ? "text-white"
                  : "border-border hover:border-muted-foreground text-foreground"
              }`}
              style={count === n ? { backgroundColor: BRAND_GREEN, borderColor: BRAND_GREEN } : undefined}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {generating ? (
            <Button variant="outline" onClick={handleStop}>
              შეჩერება
            </Button>
          ) : null}
          <Button onClick={handleGenerate} disabled={!canGenerate}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                გენერდება…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                გენერაცია
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Dedicated save-control row — own row above the grid so layout
          can never compress / hide it. Always renders once at least one
          generation has completed; disabled with an explanatory label
          when there's nothing to save yet. */}
      {hasAnyDone && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
          <div className="text-xs text-muted-foreground">
            {savableCount > 0
              ? `მზადაა ${savableCount} დიზაინი კატალოგში შესანახად.`
              : savedCount > 0 && acceptedCount === savedCount
                ? `ყველა მონიშნული დიზაინი შენახულია (${savedCount}).`
                : "მონიშნე საუკეთესო დიზაინები ✓-ით და შემდეგ შეინახე კატალოგში."}
          </div>
          <Button onClick={handleSaveBatch} disabled={!canSave}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ინახება…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                შენახვა კატალოგში{savableCount > 0 ? ` (${savableCount})` : ""}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Results grid */}
      {slots.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {slots.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              onAccept={() => toggleAccept(slot.index)}
              onReject={() => rejectSlot(slot.index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SlotCardProps {
  slot: Slot;
  onAccept: () => void;
  onReject: () => void;
}

function SlotCard({ slot, onAccept, onReject }: SlotCardProps) {
  const isError = slot.status === "error";
  const isDone = slot.status === "done";
  const isLoading = slot.status === "loading";
  const isPending = slot.status === "pending";

  const isSaving = slot.saveStatus === "transparency" || slot.saveStatus === "uploading";
  const isSaved = slot.saveStatus === "saved";
  const isSaveError = slot.saveStatus === "save-error";

  // Saved → strong brand-green outline; accepted-not-yet-saved → soft brand
  // green; save error → destructive; otherwise default border / error.
  const borderColor = isSaved
    ? BRAND_GREEN
    : isSaveError
      ? "rgb(239 68 68 / 0.6)"
      : slot.accepted
        ? `${BRAND_GREEN}80`
        : isError
          ? "rgb(239 68 68 / 0.4)"
          : "var(--border)";
  const bgTint = isSaved
    ? `${BRAND_GREEN}1A`
    : slot.accepted
      ? `${BRAND_GREEN}0D`
      : undefined;

  // Accept/reject are disabled the moment a save starts or completes —
  // we don't want admin to toggle "accepted" on a row already in the DB.
  const actionsLocked = isSaving || isSaved;

  return (
    <div
      className="rounded-lg border-2 overflow-hidden bg-card flex flex-col"
      style={{ borderColor, backgroundColor: bgTint }}
    >
      <div className="aspect-square relative bg-muted flex items-center justify-center">
        {isDone && slot.imageDataUrl && (
          <img
            src={slot.imageDataUrl}
            alt={slot.themeLabel}
            className="w-full h-full object-contain"
            loading="lazy"
          />
        )}
        {isLoading && (
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        )}
        {isPending && (
          <div className="text-[10px] text-muted-foreground">მოლოდინში…</div>
        )}
        {isError && (
          <div className="p-2 text-center">
            <AlertCircle className="h-6 w-6 mx-auto text-destructive mb-1" />
            <p className="text-[10px] text-destructive break-words">{slot.error}</p>
          </div>
        )}
        {slot.accepted && isDone && !isSaved && (
          <div
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </div>
        )}
        {isSaved && (
          <div
            className="absolute top-1.5 right-1.5 px-1.5 h-6 rounded-full flex items-center gap-1"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
            <span className="text-[10px] font-semibold text-white">შენახული</span>
          </div>
        )}
        {isSaving && (
          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <span className="text-[10px] text-white font-semibold">
              {slot.saveStatus === "transparency" ? "transparency…" : "uploading…"}
            </span>
          </div>
        )}
      </div>
      <div className="p-2 space-y-2">
        <div className="text-[10px] text-muted-foreground truncate" title={slot.themeLabel}>
          {slot.themeLabel}
        </div>
        {isSaved && slot.usedFallback && (
          <div className="flex items-start gap-1 text-[10px] text-amber-500" title="fallback transparency was used — verify the print file is clean before publishing">
            <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
            <span>fallback transparency — verify print file</span>
          </div>
        )}
        {isSaveError && slot.saveError && (
          <div className="text-[10px] text-destructive break-words" title={slot.saveError}>
            <AlertCircle className="h-3 w-3 inline-block mr-1" />
            {slot.saveError}
          </div>
        )}
        {isDone && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onAccept}
              disabled={actionsLocked}
              className={`flex-1 h-7 rounded text-xs font-medium border transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                slot.accepted ? "text-white" : "border-border hover:border-muted-foreground"
              }`}
              style={slot.accepted ? { backgroundColor: BRAND_GREEN, borderColor: BRAND_GREEN } : undefined}
              title={
                isSaved ? "შენახულია კატალოგში" :
                slot.accepted ? "მონიშნულია — დააჭირე გასაუქმებლად" : "მონიშნე საუკეთესოდ"
              }
            >
              <Check className="h-3 w-3" />
              {isSaved ? "შენახული" : slot.accepted ? "მონიშნული" : "მონიშვნა"}
            </button>
            <button
              type="button"
              onClick={onReject}
              disabled={actionsLocked}
              className="h-7 w-7 rounded border border-border hover:border-destructive hover:text-destructive flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
              title="უარყოფა"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
