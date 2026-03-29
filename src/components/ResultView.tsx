import { useState, useCallback } from "react";
import type { GenerationResult } from "@/lib/generation";
import { upscaleImage } from "@/lib/generation";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Download, Eye, Copy, Package, Maximize, ShoppingBag, Globe, Shirt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TryOnModal from "@/components/TryOnModal";

interface ResultViewProps {
  result: GenerationResult;
  onViewImage: (src: string) => void;
  productName?: string;
  colorName?: string;
  onResultUpdate?: (result: GenerationResult) => void;
  onOrder?: () => void;
  onShareToCommunity?: () => void;
  sharing?: boolean;
  isShared?: boolean;
}

export default function ResultView({ result, onViewImage, productName = "design", colorName = "", onResultUpdate, onOrder, onShareToCommunity, sharing, isShared }: ResultViewProps) {
  const { toast } = useToast();
  const { lang } = useAppState();
  const [upscaling, setUpscaling] = useState(false);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const prefix = `${productName.toLowerCase().replace(/\s/g, "-")}${colorName ? `-${colorName.toLowerCase().replace(/\s/g, "-")}` : ""}`;

  const downloadImage = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  const downloadAll = () => {
    downloadImage(result.mockupImage, `${prefix}-mockup.png`);
    setTimeout(() => downloadImage(result.transparentImage, `${prefix}-print.png`), 300);
  };

  const copyToClipboard = async (dataUrl: string) => {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Your browser may not support this.", variant: "destructive" });
    }
  };

  const handleUpscale = useCallback(async () => {
    setUpscaling(true);
    try {
      const upscaled = await upscaleImage(result.transparentImage);
      const updated = { ...result, transparentImage: upscaled };
      onResultUpdate?.(updated);
      toast({ title: "Upscaled to 4K!" });
    } catch (err: any) {
      toast({ title: "Upscale failed", description: err.message, variant: "destructive" });
    } finally {
      setUpscaling(false);
    }
  }, [result, onResultUpdate, toast]);

  return (
    <div className="flex flex-col items-center gap-6 p-6 w-full max-w-2xl mx-auto">
      {/* Top actions */}
      <div className="w-full flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={handleUpscale} disabled={upscaling}>
          <Maximize className="h-4 w-4" /> {upscaling ? t(lang, "result.upscaling") : t(lang, "result.upscale")}
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadAll}>
          <Package className="h-4 w-4" /> {t(lang, "result.downloadAll")}
        </Button>
      </div>

      {/* Mockup Card */}
      <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-card-foreground">{t(lang, "result.preview")}</h3>
        </div>
        <div className="relative group">
          <div className="absolute inset-0 overflow-hidden">
            <img src={result.mockupImage} alt="" className="w-full h-full object-cover blur-[50px] opacity-40 scale-110" />
          </div>
          <div className="relative p-4 flex justify-center">
            <img src={result.mockupImage} alt="Mockup preview" className="max-h-[500px] object-contain rounded-lg" />
          </div>
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => onViewImage(result.mockupImage)}>
              <Eye className="h-4 w-4 mr-1" /> {t(lang, "result.view")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => copyToClipboard(result.mockupImage)}>
              <Copy className="h-4 w-4 mr-1" /> {t(lang, "result.copy")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.mockupImage, `${prefix}-mockup.png`)}>
              <Download className="h-4 w-4 mr-1" /> {t(lang, "result.download")}
            </Button>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="w-full space-y-2">
        {onOrder && (
          <Button
            onClick={() => onOrder()}
            className="w-full h-14 text-lg font-bold gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black rounded-xl shadow-lg shadow-amber-500/25"
          >
            <ShoppingBag className="h-5 w-5" /> შეკვეთა
          </Button>
        )}
        {onShareToCommunity && !isShared && (
          <Button
            onClick={onShareToCommunity}
            disabled={sharing}
            variant="outline"
            className="w-full h-11 gap-2 font-medium"
          >
            <Globe className="h-4 w-4" />
            {sharing ? "..." : "გაზიარება საზოგადოებაში"}
          </Button>
        )}
        {isShared && (
          <div className="w-full text-center text-sm text-green-500 font-medium py-2">
            ✓ გაზიარებულია საზოგადოებაში
          </div>
        )}
        <Button
          onClick={() => setTryOnOpen(true)}
          variant="outline"
          className="w-full h-11 gap-2 font-medium"
        >
          <Shirt className="h-4 w-4" /> გასინჯვა
        </Button>
      </div>

      <TryOnModal
        open={tryOnOpen}
        onClose={() => setTryOnOpen(false)}
        designImage={result.transparentImage}
      />

      {/* Print File Card */}
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card overflow-hidden">
        <div className="relative group">
          <div
            className="p-6 flex justify-center"
            style={{
              backgroundImage: `
                linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%),
                linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%),
                linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)
              `,
              backgroundSize: "20px 20px",
              backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
            }}
          >
            <img src={result.transparentImage} alt="Print file" className="max-h-[300px] object-contain" />
          </div>
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => onViewImage(result.transparentImage)}>
              <Eye className="h-4 w-4 mr-1" /> {t(lang, "result.view")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.transparentImage, `${prefix}-print.png`)}>
              <Download className="h-4 w-4 mr-1" /> {t(lang, "result.downloadPng")}
            </Button>
          </div>
        </div>
        <div className="px-4 py-2 border-t border-border text-center">
          <span className="text-xs text-muted-foreground">{t(lang, "result.printFile")}</span>
        </div>
      </div>
    </div>
  );
}
