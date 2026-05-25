import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { runWithConcurrency } from "@/components/admin/catalog/designUploadHelpers";
import { Sparkles, Check, X, AlertCircle, Loader2 } from "lucide-react";

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
  prompt: string;
  imageDataUrl?: string;
  error?: string;
  accepted: boolean;
}

const BRAND_GREEN = "#26BB89";
const CONCURRENCY = 3;

function buildPromptForTheme(theme: ThemeDef | null, custom: string, index: number): { themeLabel: string; prompt: string } {
  const variation = VARIATION_HINTS[index % VARIATION_HINTS.length];
  if (theme) return { themeLabel: theme.label, prompt: theme.buildPrompt(variation) };
  // Custom prompt path — still wrap with the EN copyright guard since we
  // don't know the cultural context. If the admin's free-text mentions
  // Georgian themes they can pick the GEORGIAN tab buttons instead.
  const trimmed = custom.trim();
  return {
    themeLabel: trimmed.length > 40 ? trimmed.slice(0, 40) + "…" : trimmed,
    prompt: `original t-shirt design: ${trimmed}, ${variation}, transparent background. ${COPYRIGHT_GUARD_EN}`,
  };
}

export default function AiAgent() {
  const { toast } = useToast();
  const [selectedThemeKey, setSelectedThemeKey] = useState<string | null>(null);
  const [customTheme, setCustomTheme] = useState<string>("");
  const [count, setCount] = useState<CountChoice>(5);
  const [generating, setGenerating] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  // Set when the admin clicks "Stop"; checked between slot completions to
  // halt the batch early. Cleared on every new Generate.
  const abortFlag = useRef(false);

  const grouped = useMemo(() => {
    const groups: Record<ThemeGroup, ThemeDef[]> = { humor: [], various: [], georgian: [] };
    for (const t of THEMES) groups[t.group].push(t);
    return groups;
  }, []);

  const selectedTheme = useMemo(
    () => THEMES.find((t) => t.key === selectedThemeKey) ?? null,
    [selectedThemeKey],
  );

  const canGenerate =
    !generating && (selectedTheme !== null || customTheme.trim().length > 0);

  const acceptedCount = slots.filter((s) => s.accepted && s.status === "done").length;

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
      const { themeLabel, prompt } = buildPromptForTheme(selectedTheme, customTheme, i);
      return {
        id: `${Date.now()}-${i}`,
        index: i,
        status: "pending",
        themeLabel,
        prompt,
        accepted: false,
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
              style: "",
              styleImage: null,
              text: "",
              textImage: null,
              product: "T-Shirt",
              color: "White",
              speed: "quality",
              isRealistic: false,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: BRAND_GREEN }} />
            AI აგენტი
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            აირჩიე თემა, დააგენერირე N დიზაინი, მონიშნე საუკეთესოები.
            სტადია 1 — შენახვა კატალოგში ჯერ არ ხდება.
          </p>
        </div>
        {slots.length > 0 && (
          <div className="text-xs text-muted-foreground">
            მონიშნული: <span className="font-semibold" style={{ color: BRAND_GREEN }}>{acceptedCount}</span> / {slots.filter((s) => s.status === "done").length}
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

  const borderColor = slot.accepted
    ? `${BRAND_GREEN}80`
    : isError
      ? "rgb(239 68 68 / 0.4)"
      : "var(--border)";
  const bgTint = slot.accepted ? `${BRAND_GREEN}0D` : undefined;

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
        {slot.accepted && isDone && (
          <div
            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: BRAND_GREEN }}
          >
            <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="p-2 space-y-2">
        <div className="text-[10px] text-muted-foreground truncate" title={slot.themeLabel}>
          {slot.themeLabel}
        </div>
        {isDone && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onAccept}
              className={`flex-1 h-7 rounded text-xs font-medium border transition-colors flex items-center justify-center gap-1 ${
                slot.accepted ? "text-white" : "border-border hover:border-muted-foreground"
              }`}
              style={slot.accepted ? { backgroundColor: BRAND_GREEN, borderColor: BRAND_GREEN } : undefined}
              title={slot.accepted ? "მონიშნულია — დააჭირე გასაუქმებლად" : "მონიშნე საუკეთესოდ"}
            >
              <Check className="h-3 w-3" />
              {slot.accepted ? "მონიშნული" : "მონიშვნა"}
            </button>
            <button
              type="button"
              onClick={onReject}
              className="h-7 w-7 rounded border border-border hover:border-destructive hover:text-destructive flex items-center justify-center"
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
