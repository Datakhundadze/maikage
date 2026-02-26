import type { GenerationResult } from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Download, Eye, Copy, Package, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ResultViewProps {
  result: GenerationResult;
  onViewImage: (src: string) => void;
  productName?: string;
  colorName?: string;
  onSave?: () => void;
  saving?: boolean;
}

export default function ResultView({ result, onViewImage, productName = "design", colorName = "", onSave, saving }: ResultViewProps) {
  const { toast } = useToast();
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

  return (
    <div className="flex flex-col items-center gap-6 p-6 w-full max-w-2xl mx-auto">
      {/* Top actions */}
      <div className="w-full flex justify-end gap-2">
        {onSave && (
          <Button size="sm" variant="default" className="gap-1.5" onClick={onSave} disabled={saving}>
            <Save className="h-4 w-4" /> {saving ? "Saving..." : "Save to Cloud"}
          </Button>
        )}
        <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadAll}>
          <Package className="h-4 w-4" /> Download All
        </Button>
      </div>

      {/* Mockup Card */}
      <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-card-foreground">Preview</h3>
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
              <Eye className="h-4 w-4 mr-1" /> View
            </Button>
            <Button size="sm" variant="secondary" onClick={() => copyToClipboard(result.mockupImage)}>
              <Copy className="h-4 w-4 mr-1" /> Copy
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.mockupImage, `${prefix}-mockup.png`)}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
          </div>
        </div>
      </div>

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
              <Eye className="h-4 w-4 mr-1" /> View
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.transparentImage, `${prefix}-print.png`)}>
              <Download className="h-4 w-4 mr-1" /> Download PNG
            </Button>
          </div>
        </div>
        <div className="px-4 py-2 border-t border-border text-center">
          <span className="text-xs text-muted-foreground">Print File (PNG)</span>
        </div>
      </div>
    </div>
  );
}
