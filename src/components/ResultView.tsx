import type { GenerationResult } from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Download, Eye } from "lucide-react";

interface ResultViewProps {
  result: GenerationResult;
  onViewImage: (src: string) => void;
}

export default function ResultView({ result, onViewImage }: ResultViewProps) {
  const downloadImage = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();
  };

  return (
    <div className="flex flex-col items-center gap-6 p-6 w-full max-w-2xl mx-auto">
      {/* Mockup Card */}
      <div className="w-full rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-sm font-semibold text-card-foreground">Preview</h3>
        </div>
        <div className="relative group">
          {/* Blurred background */}
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={result.mockupImage}
              alt=""
              className="w-full h-full object-cover blur-[50px] opacity-40 scale-110"
            />
          </div>
          {/* Actual mockup */}
          <div className="relative p-4 flex justify-center">
            <img
              src={result.mockupImage}
              alt="Mockup preview"
              className="max-h-[500px] object-contain rounded-lg"
            />
          </div>
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => onViewImage(result.mockupImage)}>
              <Eye className="h-4 w-4 mr-1" /> View
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.mockupImage, "mockup.png")}>
              <Download className="h-4 w-4 mr-1" /> Download
            </Button>
          </div>
        </div>
      </div>

      {/* Print File Card */}
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card overflow-hidden">
        <div className="relative group">
          {/* Checkered bg */}
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
            <img
              src={result.transparentImage}
              alt="Print file"
              className="max-h-[300px] object-contain"
            />
          </div>
          {/* Hover overlay */}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <Button size="sm" variant="secondary" onClick={() => onViewImage(result.transparentImage)}>
              <Eye className="h-4 w-4 mr-1" /> View
            </Button>
            <Button size="sm" variant="secondary" onClick={() => downloadImage(result.transparentImage, "print-file.png")}>
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
