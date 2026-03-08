import { useState, useRef, useCallback, useMemo } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Type, X, Sparkles, ChevronDown } from "lucide-react";

const FONTS = [
  { name: "Sans Serif", family: "sans-serif", label: "Aa" },
  { name: "Serif", family: "Georgia, serif", label: "Aa" },
  { name: "Monospace", family: "'Courier New', monospace", label: "Aa" },
  { name: "Impact", family: "Impact, sans-serif", label: "Aa" },
  { name: "Comic", family: "'Comic Sans MS', cursive", label: "Aa" },
  { name: "Brush Script", family: "'Brush Script MT', cursive", label: "Aa" },
  { name: "Palatino", family: "'Palatino Linotype', serif", label: "Aa" },
  { name: "Trebuchet", family: "'Trebuchet MS', sans-serif", label: "Aa" },
  { name: "Verdana", family: "Verdana, sans-serif", label: "Aa" },
  { name: "Lucida", family: "'Lucida Console', monospace", label: "Aa" },
];

export default function SimplePage() {
  const { lang, toggleLang, theme, toggleTheme, setMode } = useAppState();
  const productConfig = useProductConfig();
  const [designImage, setDesignImage] = useState<string | null>(null);
  const [designText, setDesignText] = useState("");
  const [selectedFont, setSelectedFont] = useState(FONTS[0]);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDesignImage(reader.result as string);
    reader.readAsDataURL(file);
  }, []);

  const clearDesign = () => {
    setDesignImage(null);
    setDesignText("");
  };

  // Composite: render photo + text together onto a single canvas
  const compositeImage = useMemo(() => {
    const hasPhoto = !!designImage;
    const hasText = designText.trim().length > 0;
    if (!hasPhoto && !hasText) return null;

    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 600;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, 600, 600);

    // If only text, render centered
    if (!hasPhoto && hasText) {
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontSize = Math.min(72, 600 / (designText.length * 0.55));
      ctx.font = `bold ${fontSize}px ${selectedFont.family}`;
      ctx.fillText(designText, 300, 300, 560);
      return canvas.toDataURL("image/png");
    }

    // If only photo, return it directly (no canvas needed)
    if (hasPhoto && !hasText) return designImage;

    // Both photo + text: we need to composite after the image loads
    // Return a sentinel; actual compositing happens in an effect
    return "__composite__";
  }, [designImage, designText, selectedFont]);

  // For photo+text compositing, use a separate state
  const [compositeDataUrl, setCompositeDataUrl] = useState<string | null>(null);
  const lastCompositeKey = useRef("");

  // Effect-like via useMemo to avoid extra state
  const currentDesignImage = useMemo(() => {
    const hasPhoto = !!designImage;
    const hasText = designText.trim().length > 0;

    if (!hasPhoto && !hasText) return null;
    if (!hasPhoto && hasText) return compositeImage;
    if (hasPhoto && !hasText) return designImage;

    // Both: composite via image load
    const key = `${designImage}|${designText}|${selectedFont.family}`;
    if (key !== lastCompositeKey.current) {
      lastCompositeKey.current = key;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 600;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, 600, 600);

        // Draw photo in top ~70%
        const photoH = 420;
        const aspect = img.width / img.height;
        let drawW = 600, drawH = photoH;
        if (aspect > 600 / photoH) {
          drawH = 600 / aspect;
        } else {
          drawW = photoH * aspect;
        }
        ctx.drawImage(img, (600 - drawW) / 2, (photoH - drawH) / 2, drawW, drawH);

        // Draw text in bottom ~30%
        ctx.fillStyle = "#000000";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fontSize = Math.min(56, 580 / (designText.length * 0.55));
        ctx.font = `bold ${fontSize}px ${selectedFont.family}`;
        ctx.fillText(designText, 300, 510, 560);

        setCompositeDataUrl(canvas.toDataURL("image/png"));
      };
      img.src = designImage!;
    }
    return compositeDataUrl;
  }, [designImage, designText, selectedFont, compositeImage, compositeDataUrl]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:h-screen lg:overflow-y-auto">
        {/* Header */}
        <header className="flex items-center justify-between p-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background text-lg font-black dark:bg-primary dark:text-primary-foreground">
              M
            </div>
            <h1 className="text-xl font-bold">maika.ge</h1>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggleLang} className="text-xs font-mono px-2">
              {lang.toUpperCase()}
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleTheme} className="px-2">
              {theme === "dark" ? "☀️" : "🌙"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode("studio")} className="gap-1 text-xs">
              <Sparkles className="h-3.5 w-3.5" />
              Studio
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Product config */}
          <ProductConfigPanel
            config={productConfig.config}
            locked={false}
            onProductChange={productConfig.setProduct}
            onSubProductChange={productConfig.setSubProduct}
            onColorChange={productConfig.setColor}
            onViewChange={productConfig.setView}
          />

          {/* Design input - Photo */}
          <div className="border-t border-sidebar-border pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" />
              {lang === "en" ? "Photo" : "ფოტო"}
            </h3>
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
              <Button
                variant="outline"
                className="w-full h-20 border-dashed"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center gap-1">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {lang === "en" ? "Upload image" : "ატვირთეთ სურათი"}
                  </span>
                </div>
              </Button>
              {designImage && (
                <div className="relative inline-block">
                  <img src={designImage} alt="design" className="h-20 w-20 rounded-lg object-cover border border-border" />
                  <button
                    onClick={() => setDesignImage(null)}
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground h-5 w-5 flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Design input - Text */}
          <div className="border-t border-sidebar-border pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Type className="h-3.5 w-3.5" />
              {lang === "en" ? "Text" : "ტექსტი"}
            </h3>
            <Input
              value={designText}
              onChange={(e) => setDesignText(e.target.value)}
              placeholder={lang === "en" ? "Enter your text..." : "შეიყვანეთ ტექსტი..."}
              className="bg-card"
            />

            {/* Font picker */}
            <div className="relative">
              <button
                onClick={() => setFontPickerOpen(!fontPickerOpen)}
                className="w-full flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/50 transition-colors"
              >
                <span style={{ fontFamily: selectedFont.family }}>{selectedFont.name}</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${fontPickerOpen ? "rotate-180" : ""}`} />
              </button>
              {fontPickerOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-y-auto">
                  {FONTS.map((font) => (
                    <button
                      key={font.name}
                      onClick={() => { setSelectedFont(font); setFontPickerOpen(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                        selectedFont.name === font.name ? "bg-accent text-accent-foreground" : "text-popover-foreground"
                      }`}
                    >
                      <span style={{ fontFamily: font.family, fontSize: "15px" }}>{font.name}</span>
                      <span style={{ fontFamily: font.family }} className="text-muted-foreground text-xs">
                        The quick brown fox
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {(designImage || designText.trim()) && (
            <Button variant="outline" size="sm" onClick={clearDesign}>
              {lang === "en" ? "Clear all" : "გასუფთავება"}
            </Button>
          )}
        </div>
      </aside>

      {/* Main preview */}
      <main className="flex-1 bg-background lg:h-screen lg:overflow-y-auto">
        <ProductPreview
          productName={productConfig.config.product}
          subProduct={productConfig.config.subProduct}
          colorName={productConfig.config.color}
          view={productConfig.config.view}
          placementCoords={productConfig.config.placementCoords}
          onCoordsChange={productConfig.setPlacementCoords}
          designImage={currentDesignImage}
        />
      </main>
    </div>
  );
}
