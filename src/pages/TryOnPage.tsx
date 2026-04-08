import { useState, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Upload, X, Download, Shirt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { COLORS } from "@/lib/catalog";
import { useAppState } from "@/hooks/useAppState";

/**
 * Colorize the shirt region using flood-fill + multiply blend.
 * Starting from the center of the torso, we grow outward through all connected
 * near-white/gray pixels (the shirt fabric).  Because the shirt is a spatially
 * connected white blob separated from the background by skin/edges, the fill
 * naturally stays on the garment and never bleeds into the background.
 */
function applyGarmentColor(imageDataUrl: string, hex: string): Promise<string> {
  return new Promise((resolve) => {
    if (!hex || hex.toUpperCase() === "#FFFFFF") { resolve(imageDataUrl); return; }
    const rC = parseInt(hex.slice(1, 3), 16);
    const gC = parseInt(hex.slice(3, 5), 16);
    const bC = parseInt(hex.slice(5, 7), 16);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const W = img.width, H = img.height;
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, W, H);
        const d = imgData.data;

        // Is this pixel shirt-fabric? (bright/gray, neutral color, not skin)
        const isShirt = (i4: number): boolean => {
          const pr = d[i4], pg = d[i4 + 1], pb = d[i4 + 2];
          const brightness = (pr + pg + pb) / 3;
          const saturation = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
          const isSkin = pr > pg + 25 && pg > pb + 10;
          return brightness > 130 && saturation < 65 && !isSkin;
        };

        // Torso bounding box (safety limit — flood fill stays inside)
        const yMin = Math.floor(H * 0.25);
        const yMax = Math.floor(H * 0.85);
        const xMin = Math.floor(W * 0.12);
        const xMax = Math.floor(W * 0.88);

        // Find seed: spiral outward from upper-chest center until we hit shirt fabric
        const cx = Math.floor(W * 0.50);
        const cy = Math.floor(H * 0.47);
        let seedIdx = -1;
        const maxR = Math.floor(Math.min(W, H) * 0.18);

        outer:
        for (let radius = 0; radius <= maxR; radius += 2) {
          if (radius === 0) {
            if (isShirt((cy * W + cx) * 4)) { seedIdx = cy * W + cx; break; }
          } else {
            const steps = Math.max(8, Math.ceil(2 * Math.PI * radius / 2));
            for (let s = 0; s < steps; s++) {
              const a = (s / steps) * 2 * Math.PI;
              const nx = cx + Math.round(radius * Math.cos(a));
              const ny = cy + Math.round(radius * Math.sin(a));
              if (nx < xMin || nx >= xMax || ny < yMin || ny >= yMax) continue;
              if (isShirt((ny * W + nx) * 4)) { seedIdx = ny * W + nx; break outer; }
            }
          }
        }

        if (seedIdx < 0) { resolve(imageDataUrl); return; }

        // DFS flood fill from seed — only within torso bounds
        const visited = new Uint8Array(W * H);
        const stack: number[] = [seedIdx];
        visited[seedIdx] = 1;

        while (stack.length > 0) {
          const pxIdx = stack.pop()!;
          const px = pxIdx % W;
          const py = Math.floor(pxIdx / W);
          const i4 = pxIdx * 4;

          // Multiply blend → white becomes targetColor, gray stays proportional
          d[i4]     = Math.round((d[i4]     * rC) / 255);
          d[i4 + 1] = Math.round((d[i4 + 1] * gC) / 255);
          d[i4 + 2] = Math.round((d[i4 + 2] * bC) / 255);

          if (px > xMin)    { const n = pxIdx - 1; if (!visited[n] && isShirt(n * 4)) { visited[n] = 1; stack.push(n); } }
          if (px < xMax - 1){ const n = pxIdx + 1; if (!visited[n] && isShirt(n * 4)) { visited[n] = 1; stack.push(n); } }
          if (py > yMin)    { const n = pxIdx - W; if (!visited[n] && isShirt(n * 4)) { visited[n] = 1; stack.push(n); } }
          if (py < yMax - 1){ const n = pxIdx + W; if (!visited[n] && isShirt(n * 4)) { visited[n] = 1; stack.push(n); } }
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(imageDataUrl);
      }
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

interface TryOnState {
  mockupImage: string;
  transparentImage: string;
  productName?: string;
  subType?: string;
  colorName?: string;
}

export default function TryOnPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setMode } = useAppState();

  const goBack = () => {
    setMode("studio");
    navigate("/");
  };

  const state = location.state as TryOnState | null;

  const [personImage, setPersonImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // If navigated here without state, go back
  if (!state?.mockupImage) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">სურათი ვერ მოიძებნა.</p>
        <Button variant="outline" onClick={goBack}>
          ← უკან
        </Button>
      </div>
    );
  }

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

    // Products with unique color/texture (acid-wash, washed effect) — send the mockup so the AI
    // can see the actual garment style. Skip canvas colorization for these products.
    const TEXTURED_PRODUCTS = ["Premium Washed Hoodie", "JEL T-Shirt"];
    const isTextured = TEXTURED_PRODUCTS.includes(state.subType || "");

    // Map product sub-types to descriptive names for better AI understanding
    const getProductDescription = (subType?: string, productName?: string): string => {
      const name = (subType || productName || "").toLowerCase();
      if (name.includes("khundadze")) return "Khundadze Georgian-style t-shirt with a traditional round collar and short sleeves";
      if (name.includes("zipper") || name.includes("zip")) return "long-sleeved zip-up hoodie with a front zipper and hood";
      if (name.includes("hoodie") || name.includes("premium hoodie")) return "long-sleeved pullover hoodie with a hood";
      if (name.includes("oversize")) return "oversized short-sleeved t-shirt with a relaxed dropped-shoulder fit";
      if (name.includes("sport set") || name.includes("sport")) return "athletic sport jersey with short sleeves";
      if (name.includes("t-shirt") || name.includes("tshirt")) return "short-sleeved crew neck t-shirt";
      return subType || productName || "t-shirt";
    };

    try {
      const { data, error } = await supabase.functions.invoke("gemini-proxy", {
        body: {
          action: "virtual-tryon",
          params: {
            personImage,
            // For textured/colored products: send the full mockup so AI sees the garment style
            designImage: isTextured ? state.mockupImage : (state.transparentImage || state.mockupImage),
            productName: getProductDescription(state.subType, state.productName),
            colorName: state.colorName || "",
            useMockupStyle: isTextured,
          },
        },
      });

      let errorMsg: string | null = null;
      if (error) {
        try {
          if (error.context && typeof error.context.json === "function") {
            const body = await error.context.json();
            errorMsg = body?.error || error.message;
          }
        } catch {
          errorMsg = error.message;
        }
        throw new Error(errorMsg || "ვირტუალური გასინჯვა ვერ მოხერხდა");
      }
      if (!data?.image) throw new Error("AI-მ სურათი ვერ დააბრუნა. სცადეთ ხელახლა.");

      if (isTextured) {
        // AI already generated the correct garment color/texture — no colorization needed
        setResultImage(data.image);
      } else {
        const hex = COLORS.find(c => c.name === state.colorName)?.hex || "";
        const colored = await applyGarmentColor(data.image, hex);
        setResultImage(colored);
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={goBack}
        >
          <ArrowLeft className="h-4 w-4" />
          უკან
        </Button>
        <div className="flex items-center gap-2">
          <Shirt className="h-5 w-5 text-amber-500" />
          <h1 className="text-base font-semibold">ვირტუალური გასინჯვა</h1>
        </div>
        {state.productName && (
          <span className="text-xs text-muted-foreground ml-1">— {state.productName}</span>
        )}
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {resultImage ? (
          /* ── Result view ── */
          <div className="flex flex-col items-center gap-6">
            <div className="relative w-full max-w-lg rounded-2xl overflow-hidden border border-border shadow-lg">
              <img src={resultImage} alt="გასინჯვის შედეგი" className="w-full object-contain" />
            </div>
            <div className="flex gap-3">
              <Button
                className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-bold"
                onClick={downloadResult}
              >
                <Download className="h-4 w-4" />
                გადმოწერა
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => { setResultImage(null); setPersonImage(null); }}
              >
                ხელახლა ცდა
              </Button>
            </div>
          </div>
        ) : (
          /* ── Upload + preview view ── */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">

            {/* Left: generated mockup */}
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                დაგენერირებული დიზაინი
              </h2>
              <div className="rounded-2xl overflow-hidden border border-border bg-card">
                <div className="relative">
                  {/* blurred background */}
                  <div className="absolute inset-0 overflow-hidden">
                    <img
                      src={state.mockupImage}
                      alt=""
                      className="w-full h-full object-cover blur-[40px] opacity-40 scale-110"
                    />
                  </div>
                  <div className="relative p-6 flex justify-center">
                    <img
                      src={state.mockupImage}
                      alt="დიზაინი"
                      className="max-h-80 object-contain rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: person photo upload */}
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                თქვენი ფოტო
              </h2>

              {/* Upload / preview area */}
              <div
                className={`relative border-2 border-dashed rounded-2xl transition-all cursor-pointer min-h-[200px] flex items-center justify-center ${
                  dragging
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-border hover:border-amber-500/50 hover:bg-muted/30"
                }`}
                onClick={() => !personImage && inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                {personImage ? (
                  <div className="relative w-full">
                    <img
                      src={personImage}
                      alt="თქვენი ფოტო"
                      className="w-full max-h-80 object-contain rounded-xl"
                    />
                    <button
                      className="absolute top-2 right-2 bg-black/60 hover:bg-black/80 rounded-full p-1.5 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setPersonImage(null); }}
                    >
                      <X className="h-4 w-4 text-white" />
                    </button>
                    {/* Change photo overlay */}
                    <button
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 hover:bg-black/80 rounded-lg px-3 py-1.5 text-xs text-white transition-colors flex items-center gap-1.5"
                      onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
                    >
                      <Upload className="h-3 w-3" /> ფოტოს შეცვლა
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
                    <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">ატვირთეთ თქვენი ფოტო</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        გადმოიტანეთ ან დააჭირეთ ასარჩევად
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">PNG, JPG, WEBP</p>
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

              {/* Try-on button */}
              <Button
                onClick={handleTryOn}
                disabled={!personImage || loading}
                className="w-full h-14 text-base font-bold gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black rounded-xl shadow-lg shadow-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <span className="h-5 w-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    მუშავდება...
                  </>
                ) : (
                  <>
                    <Shirt className="h-5 w-5" />
                    გასინჯვა
                  </>
                )}
              </Button>

              {!personImage && (
                <p className="text-xs text-muted-foreground text-center">
                  ჯერ ატვირთეთ ფოტო, შემდეგ დააჭირეთ „გასინჯვა"-ს
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
