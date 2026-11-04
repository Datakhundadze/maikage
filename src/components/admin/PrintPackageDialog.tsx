import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Sparkles } from "lucide-react";
import {
  aiCleanPhoto,
  autoCleanPhoto,
  backgroundMatchesGarment,
  buildPrintPackage,
  packagePhotos,
  type PackageUnit,
  type PhotoBgMode,
  type PhotoChoice,
} from "@/lib/printPackage/buildPrintPackage";

// Admin „საბეჭდი პაკეტი" for one order (cart). Lists every customer photo with
// its background options, then builds the ZIP (PDF job sheet + print PNGs) in
// the browser. Solid backgrounds are removed automatically (free, in code);
// a real photo background is only removed when the admin clicks the AI button
// (one paid GPT call) and picks that version.

const CHECKER =
  "repeating-conic-gradient(#e5e5e5 0% 25%, #ffffff 0% 50%) 50% / 16px 16px";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  units: PackageUnit[];
}

export default function PrintPackageDialog({ open, onOpenChange, units }: Props) {
  const { toast } = useToast();
  const photos = useMemo(() => packagePhotos(units), [units]);
  const [choices, setChoices] = useState<Record<string, PhotoChoice>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);

  // Analyse every photo once per opening: solid background → default "auto".
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      setAnalyzing(true);
      const next: Record<string, PhotoChoice> = {};
      for (const p of photos) {
        try {
          const auto = await autoCleanPhoto(p.url);
          if (auto) {
            created.push(auto.url);
            // Default to the cleaned version only when it is invisible on the
            // garment; otherwise it is offered, and the admin picks.
            const safe = backgroundMatchesGarment(auto.color, p.garmentColors);
            next[p.url] = { mode: safe ? "auto" : "original", autoUrl: auto.url, autoColor: auto.color };
          } else {
            next[p.url] = { mode: "original" };
          }
        } catch {
          next[p.url] = { mode: "original" };
        }
        if (cancelled) return;
      }
      setChoices(next);
      setAnalyzing(false);
    })();
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
      setChoices({});
    };
  }, [open, photos]);

  const setMode = (url: string, mode: PhotoBgMode) =>
    setChoices((prev) => ({ ...prev, [url]: { ...(prev[url] ?? { mode: "original" }), mode } }));

  async function runAi(url: string) {
    setAiBusy(url);
    try {
      const aiUrl = await aiCleanPhoto(url);
      setChoices((prev) => ({ ...prev, [url]: { ...(prev[url] ?? { mode: "original" }), aiUrl, mode: "ai" } }));
    } catch (e) {
      toast({ title: "AI-მ ფონი ვერ მოხსნა", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setAiBusy(null);
    }
  }

  async function build() {
    setBuilding("იწყება…");
    try {
      const res = await buildPrintPackage(units, choices, setBuilding);
      toast({ title: `პაკეტი მზადაა ✓`, description: `${res.fileName} · ${res.sides} საბეჭდი ფაილი` });
      onOpenChange(false);
    } catch (e) {
      toast({ title: "პაკეტი ვერ შეიქმნა", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBuilding(null);
    }
  }

  const option = (url: string, mode: PhotoBgMode, label: string, src: string | undefined, disabled = false) => {
    const active = choices[url]?.mode === mode;
    return (
      <button
        type="button"
        disabled={disabled || !src}
        onClick={() => setMode(url, mode)}
        className={`space-y-1 text-left rounded-lg border-2 p-1 transition ${active ? "border-primary" : "border-transparent"} disabled:opacity-40`}
      >
        <div className="w-28 h-28 rounded overflow-hidden flex items-center justify-center" style={{ background: CHECKER }}>
          {src ? <img src={src} alt={label} className="max-w-full max-h-full object-contain" /> : <span className="text-[10px] text-muted-foreground px-2 text-center">—</span>}
        </div>
        <p className="text-[11px] leading-tight">{label}</p>
      </button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !building && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>საბეჭდი პაკეტი</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          ZIP: PDF ფურცელი (ესკიზი და დეტალები) + PNG ყოველ მხარეზე — გამჭვირვალე, დიზაინზე მოჭრილი, რეალურ ზომაზე, 300 DPI.
        </p>
        {photos.length > 0 && (
          <div className="space-y-4">
            <p className="text-sm font-medium">ფოტოების ფონი</p>
            {analyzing && <p className="text-sm text-muted-foreground">ფოტოები მოწმდება…</p>}
            {!analyzing &&
              photos.map((p) => {
                const ch = choices[p.url];
                return (
                  <div key={p.url} className="border border-border rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-2">{p.label}</p>
                    {ch?.autoUrl && !backgroundMatchesGarment(ch.autoColor, p.garmentColors) && (
                      <p className="text-xs text-amber-600 mb-2">
                        ერთფეროვანი ფონი ({ch.autoColor}) ესკიზზე ჩანს {p.garmentColors.join(", ")} ნაჭერზე — მოხსნა თავად აირჩიე, თუ ის ზედმეტი ჩარჩოა.
                      </p>
                    )}
                    <div className="flex gap-2 flex-wrap items-start">
                      {option(p.url, "original", "როგორც ესკიზზეა", p.url)}
                      {option(p.url, "auto", ch?.autoUrl ? "ერთფეროვანი ფონი მოხსნილი" : "ერთფეროვანი ფონი არ აქვს", ch?.autoUrl)}
                      {option(p.url, "ai", "AI-ით მოხსნილი", ch?.aiUrl)}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs gap-1 self-center"
                        disabled={aiBusy !== null || !!building}
                        onClick={() => runAi(p.url)}
                      >
                        <Sparkles className="h-3 w-3" />
                        {aiBusy === p.url ? "მუშავდება…" : ch?.aiUrl ? "AI თავიდან" : "ფონის მოხსნა AI-ით"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            <p className="text-xs text-muted-foreground">AI ღილაკი ერთ GPT გამოძახებას ხარჯავს. ჩარჩო და ერთფეროვანი ფონი უფასოდ, ავტომატურად იხსნება.</p>
          </div>
        )}
        <DialogFooter className="items-center gap-2">
          {building && <span className="text-xs text-muted-foreground mr-auto">{building}</span>}
          <Button onClick={build} disabled={analyzing || !!building || aiBusy !== null} className="gap-1.5">
            <Download className="h-4 w-4" />
            {building ? "მზადდება…" : "ჩამოტვირთვა (ZIP)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
