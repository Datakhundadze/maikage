import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, X, Download, Shirt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface TryOnModalProps {
  open: boolean;
  onClose: () => void;
  designImage: string; // transparent design or mockup data URL
}

export default function TryOnModal({ open, onClose, designImage }: TryOnModalProps) {
  const { toast } = useToast();
  const [personImage, setPersonImage] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    try {
      const { data, error } = await supabase.functions.invoke("gemini-proxy", {
        body: {
          action: "virtual-tryon",
          params: { personImage, designImage },
        },
      });

      let errorMsg: string | null = null;
      if (error) {
        try {
          if (error.context && typeof error.context.json === "function") {
            const body = await error.context.json();
            errorMsg = body?.error || error.message;
          }
        } catch { errorMsg = error.message; }
        throw new Error(errorMsg || "Virtual try-on ვერ მოხერხდა");
      }
      if (!data?.image) throw new Error("AI-მ სურათი ვერ დააბრუნა");
      setResultImage(data.image);
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
    setPersonImage(null);
    setResultImage(null);
    setLoading(false);
    onClose();
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
                  <img src={personImage} alt="Person" className="w-full max-h-64 object-contain rounded-xl" />
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
              <img src={resultImage} alt="Try-on result" className="w-full object-contain" />
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

          {/* Action button */}
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
                <Shirt className="h-4 w-4" /> გასინჯვა
              </span>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
