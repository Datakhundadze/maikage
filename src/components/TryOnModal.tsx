import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Download, Shirt, ShoppingBag } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";

// sessionStorage bridge to OrderDialog.uploadTryOnAssets, which reads these two
// keys at order time and uploads them under order-originals/{orderId}/. Keys
// MUST stay byte-identical to the reader in OrderDialog.tsx.
const TRYON_PERSON_KEY = "maika-tryon-person";
const TRYON_RESULT_KEY = "maika-tryon-result";

// Best-effort downscale of a data URL to `maxEdge`px on the long edge, encoded
// as JPEG at `quality`. Keeps the stashed person photo well under the ~5MB
// sessionStorage budget. Returns the original string if anything goes wrong —
// this is a size optimisation, never a hard requirement.
async function downscaleDataUrl(dataUrl: string, maxEdge = 1200, quality = 0.8): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return dataUrl;
  }
}

// Stash the try-on person photo + result for OrderDialog to attach to the order.
// Quota-safe and fully best-effort: a QuotaExceededError (a phone photo can blow
// the sessionStorage budget) is logged and swallowed so the working try-on flow
// never breaks. The RESULT is written first and as-is — it's the artefact admin
// needs — so if only one fits, the result wins and the person photo is dropped.
async function persistTryOnAssets(personImage: string, resultImage: string): Promise<void> {
  let resultStored = false;
  try {
    sessionStorage.setItem(TRYON_RESULT_KEY, resultImage);
    resultStored = true;
  } catch (e) {
    console.warn("[TryOnModal] could not stash try-on result:", e);
    try { sessionStorage.removeItem(TRYON_RESULT_KEY); } catch { /* ignore */ }
  }

  if (!resultStored) {
    // Result alone didn't fit — don't leave a lone person photo behind to
    // attach to an order with no matching result.
    try { sessionStorage.removeItem(TRYON_PERSON_KEY); } catch { /* ignore */ }
    return;
  }

  try {
    const personSmall = await downscaleDataUrl(personImage, 1200, 0.8);
    sessionStorage.setItem(TRYON_PERSON_KEY, personSmall);
  } catch (e) {
    // Result is already stored; drop the person photo silently rather than fail both.
    console.warn("[TryOnModal] could not stash try-on person photo:", e);
    try { sessionStorage.removeItem(TRYON_PERSON_KEY); } catch { /* ignore */ }
  }
}

interface TryOnModalProps {
  open: boolean;
  onClose: () => void;
  designImage: string; // transparent design or mockup data URL
  /** Optional — when provided, an "Order" CTA appears below the try-on
   *  result so the user can proceed straight to the order flow with this
   *  design. Omitted by generic callers (e.g. Studio), hiding the button. */
  onOrder?: () => void;
}

export default function TryOnModal({ open, onClose, designImage, onOrder }: TryOnModalProps) {
  const { toast } = useToast();
  const { lang } = useAppState();
  const [personImage, setPersonImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // True only when the user left via the "Order" CTA, so handleClose keeps the
  // stashed assets (the order flow needs them) instead of clearing them.
  const orderedRef = useRef(false);

  const loadFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "გთხოვ ატვირთეთ სურათი", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setPersonImage(e.target?.result as string);
      setResultImage(null);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const handleTryOn = async () => {
    if (!personImage) return;
    setLoading(true);
    setResultImage(null);
    // Fresh run: any prior "ordered" intent no longer applies.
    orderedRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke("gemini-proxy", {
        body: {
          action: "virtual-tryon",
          params: { personImage, designImage },
        },
      });

      if (error) {
        let body: { code?: string; requiresLogin?: boolean; error?: string } | null = null;
        try {
          if (error.context && typeof error.context.json === "function") {
            body = await error.context.json();
          }
        } catch { /* ignore parse errors */ }
        // Rate limited (429): toast the limit message and stop — don't fall
        // through to the generic "try-on failed" error.
        if (body?.code === "RATE_LIMITED") {
          toast({
            title: t(lang, body.requiresLogin ? "rateLimit.signInTitle" : "rateLimit.slowDownTitle"),
            description: t(lang, body.requiresLogin ? "rateLimit.signIn" : "rateLimit.slowDown"),
          });
          return;
        }
        throw new Error(body?.error || error.message || "Virtual try-on ვერ მოხერხდა");
      }
      if (!data?.image) throw new Error("AI-მ სურათი ვერ დააბრუნა");
      setResultImage(data.image);
      // Stash person + result so OrderDialog.uploadTryOnAssets can attach them
      // to the order. Only in an order-capable context (onOrder present) so a
      // casual Studio try-on leaves no stale keys. Best-effort — persist never
      // throws, so it can't break the working try-on flow.
      if (onOrder) {
        await persistTryOnAssets(personImage, data.image);
      }
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const downloadResult = () => {
    if (!resultImage) return;
    const a = document.createElement("a");
    a.href = resultImage;
    a.download = "tryon-result.png";
    a.click();
  };

  const handleClose = () => {
    // Closing WITHOUT ordering discards the try-on, so drop any stashed assets
    // — they must never attach themselves to an unrelated later order. When the
    // close is the order flow itself (orderedRef), keep them for OrderDialog.
    if (!orderedRef.current) {
      try { sessionStorage.removeItem(TRYON_PERSON_KEY); } catch { /* ignore */ }
      try { sessionStorage.removeItem(TRYON_RESULT_KEY); } catch { /* ignore */ }
    }
    orderedRef.current = false;
    setPersonImage(null);
    setResultImage(null);
    setLoading(false);
    onClose();
  };

  // The "Order" CTA closes the modal on its way into the order flow; mark the
  // exit as intentional so handleClose preserves the stashed try-on assets.
  const handleOrderClick = () => {
    orderedRef.current = true;
    onOrder?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shirt className="h-5 w-5 text-amber-500" />
            ვირტუალური გასინჯვა
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload area */}
          {!resultImage && (
            <div
              className={`relative border-2 border-dashed rounded-xl transition-colors cursor-pointer ${
                dragging ? "border-amber-500 bg-amber-500/10" : "border-border hover:border-amber-500/50"
              }`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              {personImage ? (
                <div className="relative">
                  <img src={personImage} alt="Person" width={600} height={800} className="w-full max-h-64 object-contain rounded-xl" loading="eager" />
                  <button
                    className="absolute top-2 right-2 bg-black/60 rounded-full p-1 hover:bg-black/80 transition-colors"
                    onClick={(e) => { e.stopPropagation(); setPersonImage(null); setResultImage(null); }}
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                  <Upload className="h-8 w-8" />
                  <p className="text-sm font-medium">ატვირთეთ თქვენი ფოტო</p>
                  <p className="text-xs">გადმოიტანეთ ან დააჭირეთ</p>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Result */}
          {resultImage && (
            <div className="relative rounded-xl overflow-hidden border border-border">
              <img src={resultImage} alt="Try-on result" width={800} height={1000} className="w-full object-contain" loading="eager" fetchPriority="high" />
              <div className="absolute top-2 right-2 flex gap-2">
                <Button size="sm" variant="secondary" className="gap-1.5" onClick={downloadResult}>
                  <Download className="h-3.5 w-3.5" /> გადმოწერა
                </Button>
                <button
                  className="bg-black/60 rounded-md p-1.5 hover:bg-black/80 transition-colors"
                  onClick={() => { setResultImage(null); }}
                >
                  <X className="h-4 w-4 text-white" />
                </button>
              </div>
            </div>
          )}

          {/* Order this design — only when invoked from a flow that supplies
              onOrder (Simple). Generic callers (Studio) omit it, hiding this. */}
          {resultImage && onOrder && (
            <Button
              onClick={handleOrderClick}
              className="w-full h-12 text-base font-bold rounded-xl gap-2"
            >
              <ShoppingBag className="h-4 w-4" /> {t(lang, "tryOn.order")}
            </Button>
          )}

          {/* Run button — only before a result exists. After a successful
              try-on the result reads as final, so only the Order CTA shows. */}
          {!resultImage && (
            <Button
              onClick={handleTryOn}
              disabled={!personImage || loading}
              className="w-full h-12 text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black rounded-xl"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin h-4 w-4 border-2 border-black/30 border-t-black rounded-full" />
                  მუშავდება...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Shirt className="h-4 w-4" /> {t(lang, "tryOn.run")}
                </span>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
