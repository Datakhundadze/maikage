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
import type { CategorySlug } from "@/lib/categories";
import { Sparkles, Check, X, AlertCircle, Loader2, Save, AlertTriangle } from "lucide-react";

// ---- THEMES ------------------------------------------------------------
//
// Every prompt is wrapped with a "no-copyright" guard. Georgian themes get
// an extra-strict guard (no Pirosmani-style copies, no real Georgian public
// figures, no real logos / sports team emblems) because Georgian cultural
// themes more often tempt the model toward reproductions of real artists or
// institutions.
//
// Each theme produces ORIGINAL designs. Humor + Various themes generate
// English copy; Georgian themes generate Georgian copy where text applies.

type ThemeGroup = "humor" | "various" | "georgian";

interface ThemeDef {
  key: string;
  label: string;
  group: ThemeGroup;
  /** Returns the character prompt for variation index `i`. The variation
   *  hint is appended so a batch of N designs from the same theme isn't
   *  N identical outputs. */
  buildPrompt: (variationHint: string) => string;
}

const COPYRIGHT_GUARD_EN =
  "no real brands, no real logos, no real or famous people, " +
  "no movie/TV/anime/cartoon characters, no band or musician names, " +
  "no sports teams or franchises, no copyrighted phrases or slogans";

const COPYRIGHT_GUARD_KA =
  "original Georgian-inspired motifs only, " +
  "NO reproductions of any specific artist's work (e.g. no Pirosmani-style copies), " +
  "no real Georgian public figures, no real logos or sports team emblems, " +
  "no copyrighted material — original design only";

const THEMES: ThemeDef[] = [
  // HUMOR
  {
    key: "funny-slogans", label: "Funny slogans", group: "humor",
    buildPrompt: (v) =>
      `original funny English slogan typography t-shirt design, witty original text, bold lettering, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "sarcastic-quotes", label: "Sarcastic quotes", group: "humor",
    buildPrompt: (v) =>
      `original sarcastic English quote typography, dry humor original text, modern lettering, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "office-humor", label: "Office humor", group: "humor",
    buildPrompt: (v) =>
      `original office-themed funny English slogan design with simple iconic graphics, work-life humor, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "animal-puns", label: "Animal puns", group: "humor",
    buildPrompt: (v) =>
      `original animal pun illustration with English wordplay text, cute hand-drawn illustrated animal, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}, no named or franchise characters`,
  },

  // VARIOUS
  {
    key: "minimalist-line", label: "Minimalist line art", group: "various",
    buildPrompt: (v) =>
      `original minimalist single-line art illustration, elegant continuous line drawing, monochrome, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "retro-vintage", label: "Retro/vintage", group: "various",
    buildPrompt: (v) =>
      `original retro vintage-inspired design with original English slogan, 70s/80s aesthetic, faded color palette, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "abstract-geometric", label: "Abstract geometric", group: "various",
    buildPrompt: (v) =>
      `original abstract geometric composition, bold shapes and modern lines, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "nature-outdoor", label: "Nature/outdoor", group: "various",
    buildPrompt: (v) =>
      `original nature and outdoor adventure illustration — mountains, forests, or wildlife — hand-drawn style, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}, no real national-park or trail logos`,
  },
  {
    key: "streetwear-grunge", label: "Streetwear/grunge", group: "various",
    buildPrompt: (v) =>
      `original streetwear grunge-style design with bold original English text, distressed textures, urban aesthetic, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  },
  {
    key: "cute-characters", label: "Cute characters", group: "various",
    buildPrompt: (v) =>
      `original cute illustrated original character design, kawaii style, friendly original creature, ${v}, transparent background. ${COPYRIGHT_GUARD_EN}, no Disney/Pixar/Nintendo/anime franchise references, no named existing characters`,
  },

  // GEORGIAN — extra-strict guard
  {
    key: "ka-ornament", label: "ქართული ორნამენტი", group: "georgian",
    buildPrompt: (v) =>
      `original Georgian-inspired ornamental pattern design, traditional-style decorative motifs, ${v}, transparent background. ${COPYRIGHT_GUARD_KA}`,
  },
  {
    key: "ka-calligraphy", label: "ქართული კალიგრაფია", group: "georgian",
    buildPrompt: (v) =>
      `original Georgian calligraphy typography design with original Georgian-language word, elegant Mkhedruli or Asomtavruli lettering, ${v}, transparent background. ${COPYRIGHT_GUARD_KA}`,
  },
  {
    key: "ka-landscape", label: "ქართული პეიზაჟი", group: "georgian",
    buildPrompt: (v) =>
      `original Georgian-inspired landscape illustration — mountains, villages, or Caucasus scenery — ${v}, transparent background. ${COPYRIGHT_GUARD_KA}`,
  },
  {
    key: "ka-folk-abstract", label: "ქართული ფოლკლორ-აბსტრაქტი", group: "georgian",
    buildPrompt: (v) =>
      `original abstract design inspired by Georgian folklore symbolism, bold geometric and decorative motifs, ${v}, transparent background. ${COPYRIGHT_GUARD_KA}`,
  },
];

const GROUP_LABEL: Record<ThemeGroup, string> = {
  humor: "HUMOR",
  various: "VARIOUS",
  georgian: "ქართული (GEORGIAN)",
};

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
  /** Theme group is captured so the save flow can map it to a catalog
   *  category slug. `null` for custom-text prompts. */
  themeGroup: ThemeGroup | null;
  themeKey: string;
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
): { themeLabel: string; prompt: string } {
  const variation = VARIATION_HINTS[index % VARIATION_HINTS.length];
  // Style phrase appended AFTER the per-theme prompt + copyright guard so
  // the guard's "no copyrighted material" sentence ends the theme block,
  // and the style cue runs as its own clause. The same phrase is also
  // sent to gemini-proxy as the `style` param (see the invoke call).
  const stylePhrase = ` ${style.phrase}.`;
  if (theme) return { themeLabel: theme.label, prompt: theme.buildPrompt(variation) + stylePhrase };
  // Custom prompt path — still wrap with the EN copyright guard since we
  // don't know the cultural context. If the admin's free-text mentions
  // Georgian themes they can pick the GEORGIAN tab buttons instead.
  const trimmed = custom.trim();
  return {
    themeLabel: trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed,
    prompt: `original t-shirt design: ${trimmed}, ${variation}, transparent background. ${COPYRIGHT_GUARD_EN}${stylePhrase}`,
  };
}

// Theme group → catalog category slug. Three of the catalog's 14 slugs
// match the agent groups exactly; custom-prompt designs default to
// "various". Admin can recategorize later from the catalog grid.
const CATEGORY_BY_GROUP: Record<ThemeGroup, CategorySlug> = {
  humor: "humor",
  various: "various",
  georgian: "georgian",
};

function categoryForSlot(group: ThemeGroup | null): CategorySlug {
  return group ? CATEGORY_BY_GROUP[group] : "various";
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

  const grouped = useMemo(() => {
    const groups: Record<ThemeGroup, ThemeDef[]> = { humor: [], various: [], georgian: [] };
    for (const t of THEMES) groups[t.group].push(t);
    return groups;
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
      const { themeLabel, prompt } = buildPromptForTheme(selectedTheme, customTheme, selectedStyle, i);
      return {
        id: `${Date.now()}-${i}`,
        index: i,
        status: "pending",
        themeLabel,
        themeGroup: selectedTheme?.group ?? null,
        themeKey: selectedTheme?.key ?? "custom",
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
              text: "",
              textImage: null,
              product: "T-Shirt",
              color: "White",
              speed: slot.isRealistic ? "pro" : "quality",
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
        const category = categoryForSlot(slot.themeGroup);
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

      {/* Theme group buttons */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        {(["humor", "various", "georgian"] as ThemeGroup[]).map((group) => (
          <div key={group}>
            <h3 className="text-xs font-semibold uppercase tracking-wider mb-2 text-muted-foreground">
              {GROUP_LABEL[group]}
            </h3>
            <div className="flex flex-wrap gap-2">
              {grouped[group].map((theme) => {
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
