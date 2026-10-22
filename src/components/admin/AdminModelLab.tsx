import { useState } from "react";
import { chromaKeyGreen } from "@/lib/chromaKey";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FlaskConical, Loader2 } from "lucide-react";

// Admin → "AI მოდელების ტესტი": run ONE prompt through several image models
// side by side (gemini-proxy action "probe-image-model", admin-only, add-only).
// Used to decide whether design generation should move from Gemini to the
// OpenAI GPT Image models. Each model = one paid generation, logged in ai_calls.

const MODELS = [
  { id: "openai/gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", note: "სწრაფი" },
  { id: "openai/gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", note: "ხარისხიანი" },
  { id: "openai/gpt-image-2", label: "GPT Image 2", note: "" },
  { id: "google/gemini-3-pro-image", label: "Gemini 3 Pro Image", note: "ახლა: რეალისტური" },
  { id: "google/gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", note: "ახლა: წარწერა" },
  { id: "google/gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", note: "ახლა: უწარწერო" },
] as const;

const SAMPLE_PROMPTS = [
  'T-shirt print design, bold hand-lettered Georgian text "თბილისი" with a small illustration of Narikala fortress, vibrant colors, flat vector style, centered, isolated on a plain white background',
  "T-shirt print design, photorealistic portrait of a Caucasian shepherd dog in a chokha, dramatic studio light, centered, isolated on a plain white background",
  "T-shirt print design, cute cartoon khinkali character waving, thick outlines, flat colors, centered, isolated on a plain white background",
];

interface Attempt {
  label: string;
  endpoint: string;
  status: number;
  ms: number;
  ok: boolean;
  shape: string;
}

interface ProbeResult {
  model: string;
  state: "running" | "done" | "error";
  ok?: boolean;
  image?: string | null;
  endpoint?: string | null;
  usage?: unknown;
  totalMs?: number;
  attempts?: Attempt[];
  error?: string;
  alpha?: { transparentShare: number } | null;
}

/** Share of pixels with alpha < 250 — >3 % means the PNG really has a transparent background. */
async function measureAlpha(src: string): Promise<{ transparentShare: number } | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    const w = Math.min(256, img.naturalWidth);
    const h = Math.round((img.naturalHeight / img.naturalWidth) * w);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    let t = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) t++;
    return { transparentShare: t / (w * h) };
  } catch {
    return null;
  }
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#d8d8d8 25%,transparent 25%),linear-gradient(-45deg,#d8d8d8 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#d8d8d8 75%),linear-gradient(-45deg,transparent 75%,#d8d8d8 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0,0 8px,8px -8px,-8px 0",
  backgroundColor: "#f4f4f4",
};

export default function AdminModelLab() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  const [selected, setSelected] = useState<string[]>([
    "openai/gpt-image-2.5-flare",
    "openai/gpt-image-2.5-sunburst",
    "google/gemini-3-pro-image",
  ]);
  const [transparent, setTransparent] = useState(true);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const update = (model: string, patch: Partial<ProbeResult>) =>
    setResults((rs) => rs.map((r) => (r.model === model ? { ...r, ...patch } : r)));

  const run = async () => {
    if (running || selected.length === 0 || !prompt.trim()) return;
    setRunning(true);
    setResults(selected.map((model) => ({ model, state: "running" })));
    // Sequential on purpose: comparable timings, and a format error on the
    // first model shows up before the rest are paid for.
    for (const model of selected) {
      try {
        const { data, error } = await supabase.functions.invoke("gemini-proxy", {
          body: { action: "probe-image-model", params: { model, prompt: prompt.trim(), transparent, quality } },
        });
        if (error) {
          let msg = error.message;
          try {
            const b = await error.context?.json?.();
            if (b?.error) msg = `${b.error}${b.code ? ` (${b.code})` : ""}`;
          } catch {
            /* keep message */
          }
          update(model, { state: "error", error: msg });
          continue;
        }
        const alpha = data?.image ? await measureAlpha(data.image) : null;
        update(model, { state: "done", ...data, alpha });
      } catch (e) {
        update(model, { state: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setRunning(false);
  };

  const label = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FlaskConical className="h-5 w-5" /> AI მოდელების ტესტი
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          ერთი prompt რამდენიმე მოდელზე, გვერდიგვერდ. თითო მოდელი = 1 ფასიანი გენერაცია (ჩაიწერება ai_calls-ში). საიტის
          გენერაციას არ ეხება.
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {SAMPLE_PROMPTS.map((p, i) => (
            <Button key={i} size="sm" variant="outline" onClick={() => setPrompt(p)} disabled={running}>
              მაგალითი {i + 1}: {["ქართული წარწერა", "რეალისტური", "ილუსტრაცია"][i]}
            </Button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={running}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {MODELS.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} disabled={running} />
            {m.label}
            {m.note && <span className="text-xs text-muted-foreground">({m.note})</span>}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} disabled={running} />
          გამჭვირვალე ფონი მოვთხოვოთ
        </label>
        <label className="flex items-center gap-2 text-sm">
          ხარისხი (GPT):
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as "low" | "medium" | "high")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            disabled={running}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <Button onClick={run} disabled={running || selected.length === 0 || !prompt.trim()}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          გაშვება ({selected.length} გენერაცია)
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {results.map((r) => (
            <div key={r.model} className="rounded-lg border border-border p-3 space-y-2">
              <div className="font-medium text-sm">{label(r.model)}</div>
              <div className="aspect-square rounded-md overflow-hidden flex items-center justify-center" style={CHECKER}>
                {r.state === "running" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
                {r.state === "done" && r.image && <img src={r.image} alt="" className="max-h-full max-w-full object-contain" />}
                {r.state === "done" && !r.image && <span className="text-sm text-destructive p-4 text-center">სურათი არ დაბრუნდა</span>}
                {r.state === "error" && <span className="text-sm text-destructive p-4 text-center">{r.error}</span>}
              </div>
              {r.state === "done" && (
                <div className="text-xs space-y-1">
                  <div>დრო: <b>{((r.totalMs ?? 0) / 1000).toFixed(1)} წმ</b></div>
                  <div>
                    გამჭვირვალე:{" "}
                    <b>
                      {r.alpha == null ? "—" : r.alpha.transparentShare > 0.03 ? `კი (${Math.round(r.alpha.transparentShare * 100)}%)` : "არა"}
                    </b>
                  </div>
                  {r.endpoint && <div className="text-muted-foreground break-all">endpoint: {r.endpoint.replace("https://ai.gateway.lovable.dev", "")}</div>}
                  {r.usage != null && <div className="text-muted-foreground break-all">usage: {JSON.stringify(r.usage)}</div>}
                </div>
              )}
              {r.attempts && r.attempts.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">მცდელობები ({r.attempts.length})</summary>
                  <div className="space-y-2 mt-2">
                    {r.attempts.map((a, i) => (
                      <div key={i} className="rounded bg-muted p-2">
                        <div>
                          <b>{a.label}</b> · HTTP {a.status} · {(a.ms / 1000).toFixed(1)} წმ · {a.ok ? "✓" : "✗"}
                        </div>
                        <pre className="whitespace-pre-wrap break-all text-[10px] mt-1 max-h-40 overflow-auto">{a.shape}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      <PhotoEditLab />
    </div>
  );
}

// ── ADD-ONLY (2026-10-22): photo-action comparison ─────────────────────────
// Same idea as above, but for the PHOTO actions that carry most of the AI
// spend (isolate-subject, restyle, edit-image). Calls gemini-proxy action
// "probe-image-edit" (admin-only), which sends the production instruction
// text; production actions are untouched. A Gemini isolate result comes back
// on a #00FF00 screen, so it is chroma-keyed here exactly like production
// (chromaKeyGreen) to make the two transparent results comparable.

type PhotoTask = "isolate-subject" | "restyle" | "edit-image";

const PHOTO_TASKS: { id: PhotoTask; label: string; sample: string }[] = [
  { id: "isolate-subject", label: "ფონის მოხსნა (ფოტო)", sample: "" },
  { id: "restyle", label: "სტილის შეცვლა", sample: "watercolor painting style" },
  { id: "edit-image", label: "რედაქტირება", sample: "put black round sunglasses on the subject" },
];

/** Downscale an uploaded photo to max 1536 px on the long side, as JPEG. */
async function fileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface PhotoResult extends ProbeResult {
  keyed?: string | null;
}

function PhotoEditLab() {
  const [photo, setPhoto] = useState<string | null>(null);
  const [task, setTask] = useState<PhotoTask>("isolate-subject");
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState<string[]>([
    "openai/gpt-image-2.5-flare",
    "openai/gpt-image-2.5-sunburst",
    "google/gemini-3-pro-image",
  ]);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [results, setResults] = useState<PhotoResult[]>([]);
  const [running, setRunning] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const needsInstruction = task !== "isolate-subject";
  const canRun = !running && !!photo && selected.length > 0 && (!needsInstruction || !!instruction.trim());

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const update = (model: string, patch: Partial<PhotoResult>) =>
    setResults((rs) => rs.map((r) => (r.model === model ? { ...r, ...patch } : r)));

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    try {
      setPhoto(await fileToDataUrl(file));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : String(e));
    }
  };

  const chooseTask = (t: PhotoTask) => {
    setTask(t);
    setInstruction(PHOTO_TASKS.find((x) => x.id === t)?.sample ?? "");
  };

  const run = async () => {
    if (!canRun || !photo) return;
    setRunning(true);
    setResults(selected.map((model) => ({ model, state: "running" })));
    for (const model of selected) {
      try {
        const { data, error } = await supabase.functions.invoke("gemini-proxy", {
          body: {
            action: "probe-image-edit",
            params: { model, task, image: photo, instruction: instruction.trim(), quality },
          },
        });
        if (error) {
          let msg = error.message;
          try {
            const b = await error.context?.json?.();
            if (b?.error) msg = `${b.error}${b.code ? ` (${b.code})` : ""}`;
          } catch {
            /* keep message */
          }
          update(model, { state: "error", error: msg });
          continue;
        }
        let keyed: string | null = null;
        if (data?.image && task === "isolate-subject" && model.startsWith("google/")) {
          try {
            keyed = (await chromaKeyGreen(data.image)).image;
          } catch {
            keyed = null;
          }
        }
        const alpha = data?.image ? await measureAlpha(keyed ?? data.image) : null;
        update(model, { state: "done", ...data, keyed, alpha });
      } catch (e) {
        update(model, { state: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
    setRunning(false);
  };

  const label = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;

  return (
    <div className="space-y-4 border-t border-border pt-6">
      <div>
        <h3 className="text-base font-semibold">ფოტოს დამუშავება — მოდელების შედარება</h3>
        <p className="text-sm text-muted-foreground mt-1">
          ერთი ფოტო, იგივე ინსტრუქცია, რაც საიტზე იგზავნება. თითო მოდელი = 1 ფასიანი დამუშავება (ai_calls-ში). საიტის
          მოქმედებებს არ ეხება.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void onFile(e.target.files?.[0])}
          disabled={running}
          className="text-sm"
        />
        {photo && <img src={photo} alt="" className="h-20 w-20 object-contain rounded border border-border" />}
        {fileError && <span className="text-sm text-destructive">{fileError}</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {PHOTO_TASKS.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={task === t.id ? "default" : "outline"}
            onClick={() => chooseTask(t.id)}
            disabled={running}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {needsInstruction && (
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={2}
          placeholder="ინსტრუქცია"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={running}
        />
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {MODELS.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} disabled={running} />
            {m.label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          ხარისხი (GPT):
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as "low" | "medium" | "high")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            disabled={running}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <Button onClick={run} disabled={!canRun}>
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          გაშვება ({selected.length} დამუშავება)
        </Button>
      </div>

      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {results.map((r) => (
            <div key={r.model} className="rounded-lg border border-border p-3 space-y-2">
              <div className="font-medium text-sm">{label(r.model)}</div>
              <div className="aspect-square rounded-md overflow-hidden flex items-center justify-center" style={CHECKER}>
                {r.state === "running" && <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />}
                {r.state === "done" && r.image && (
                  <img src={r.keyed ?? r.image} alt="" className="max-h-full max-w-full object-contain" />
                )}
                {r.state === "done" && !r.image && <span className="text-sm text-destructive p-4 text-center">სურათი არ დაბრუნდა</span>}
                {r.state === "error" && <span className="text-sm text-destructive p-4 text-center">{r.error}</span>}
              </div>
              {r.state === "done" && (
                <div className="text-xs space-y-1">
                  <div>დრო: <b>{((r.totalMs ?? 0) / 1000).toFixed(1)} წმ</b></div>
                  {task === "isolate-subject" && (
                    <div>
                      გამჭვირვალე{r.keyed ? " (მწვანე ამოჭრილია)" : ""}:{" "}
                      <b>
                        {r.alpha == null ? "—" : r.alpha.transparentShare > 0.03 ? `კი (${Math.round(r.alpha.transparentShare * 100)}%)` : "არა"}
                      </b>
                    </div>
                  )}
                  {r.endpoint && <div className="text-muted-foreground break-all">endpoint: {r.endpoint.replace("https://ai.gateway.lovable.dev", "")}</div>}
                  {r.usage != null && <div className="text-muted-foreground break-all">usage: {JSON.stringify(r.usage)}</div>}
                </div>
              )}
              {r.attempts && r.attempts.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">მცდელობები ({r.attempts.length})</summary>
                  <div className="space-y-2 mt-2">
                    {r.attempts.map((a, i) => (
                      <div key={i} className="rounded bg-muted p-2">
                        <div>
                          <b>{a.label}</b> · HTTP {a.status} · {(a.ms / 1000).toFixed(1)} წმ · {a.ok ? "✓" : "✗"}
                        </div>
                        <pre className="whitespace-pre-wrap break-all text-[10px] mt-1 max-h-40 overflow-auto">{a.shape}</pre>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
