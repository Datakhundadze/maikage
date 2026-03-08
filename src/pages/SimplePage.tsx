import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview, { type DesignLayer } from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Type, X, Sparkles, ChevronDown, Palette } from "lucide-react";
import type { PlacementCoords } from "@/lib/catalog";
import { useAnalytics } from "@/hooks/useAnalytics";

const FONTS = [
  { name: "Sans Serif", family: "sans-serif" },
  { name: "Serif", family: "Georgia, serif" },
  { name: "Monospace", family: "'Courier New', monospace" },
  { name: "Impact", family: "Impact, sans-serif" },
  { name: "Comic Sans", family: "'Comic Sans MS', cursive" },
  { name: "Brush Script", family: "'Brush Script MT', cursive" },
  { name: "Palatino", family: "'Palatino Linotype', serif" },
  { name: "Trebuchet", family: "'Trebuchet MS', sans-serif" },
  { name: "Verdana", family: "Verdana, sans-serif" },
  { name: "Lucida", family: "'Lucida Console', monospace" },
  { name: "Noto Sans Georgian", family: "'Noto Sans Georgian', sans-serif" },
  { name: "Noto Serif Georgian", family: "'Noto Serif Georgian', serif" },
  { name: "BPG Arial", family: "'BPG Arial', sans-serif" },
];

const TEXT_COLORS = [
  { name: "Black", hex: "#000000" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Red", hex: "#DC2626" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Green", hex: "#16A34A" },
  { name: "Yellow", hex: "#EAB308" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Purple", hex: "#9333EA" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Gray", hex: "#6B7280" },
  { name: "Gold", hex: "#D4A017" },
  { name: "Navy", hex: "#1E3A5F" },
];

interface SideData {
  designImage: string | null;
  designText: string;
  selectedFont: typeof FONTS[0];
  textColor: string;
  photoCoords: PlacementCoords;
  textCoords: PlacementCoords;
}

const DEFAULT_SIDE: SideData = {
  designImage: null,
  designText: "",
  selectedFont: FONTS[0],
  textColor: "#000000",
  photoCoords: { x: 0.5, y: 0.38, scale: 0.35, scaleY: 0.35 },
  textCoords: { x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 },
};

export default function SimplePage() {
  const { lang, toggleLang, theme, toggleTheme, setMode } = useAppState();
  const productConfig = useProductConfig();
  const { trackEvent } = useAnalytics();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    trackEvent("page_visit", { page: "simple" });
  }, [trackEvent]);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);

  // Per-side state
  const [frontData, setFrontData] = useState<SideData>({ ...DEFAULT_SIDE });
  const [backData, setBackData] = useState<SideData>({ ...DEFAULT_SIDE });

  const currentView = productConfig.config.view;
  const isFront = currentView === "front";
  const sideData = isFront ? frontData : backData;
  const setSideData = isFront ? setFrontData : setBackData;

  // Helpers to update current side
  const updateField = <K extends keyof SideData>(key: K, value: SideData[K]) => {
    setSideData(prev => ({ ...prev, [key]: value }));
  };

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setSideData(prev => ({ ...prev, designImage: result }));
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-uploaded
    e.target.value = "";
  }, [setSideData]);

  const clearDesign = () => {
    setSideData(prev => ({
      ...prev,
      designImage: null,
      designText: "",
    }));
  };

  // Generate text as a transparent canvas image
  const [textImage, setTextImage] = useState<string | null>(null);
  useEffect(() => {
    if (!sideData.designText.trim()) {
      setTextImage(null);
      return;
    }
    document.fonts.ready.then(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = 200;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, 800, 200);
      ctx.fillStyle = sideData.textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fontSize = Math.min(120, 760 / (sideData.designText.length * 0.55));
      ctx.font = `bold ${fontSize}px ${sideData.selectedFont.family}`;
      ctx.fillText(sideData.designText, 400, 100, 760);
      setTextImage(canvas.toDataURL("image/png"));
    });
  }, [sideData.designText, sideData.selectedFont, sideData.textColor]);

  // Build layers array
  const layers = useMemo<DesignLayer[]>(() => {
    const result: DesignLayer[] = [];
    if (sideData.designImage) {
      result.push({
        id: "photo",
        image: sideData.designImage,
        coords: sideData.photoCoords,
        onCoordsChange: (c) => setSideData(prev => ({ ...prev, photoCoords: c })),
        accentClass: "bg-blue-500",
      });
    }
    if (textImage) {
      result.push({
        id: "text",
        image: textImage,
        coords: sideData.textCoords,
        onCoordsChange: (c) => setSideData(prev => ({ ...prev, textCoords: c })),
        accentClass: "bg-emerald-500",
      });
    }
    return result;
  }, [sideData.designImage, textImage, sideData.photoCoords, sideData.textCoords, setSideData]);

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

          {/* Side indicator */}
          <div className="text-xs text-muted-foreground text-center">
            {lang === "en"
              ? `Editing: ${isFront ? "Front" : "Back"} side`
              : `რედაქტირება: ${isFront ? "წინა" : "უკანა"} მხარე`}
          </div>

          {/* Photo upload */}
          <div className="border-t border-sidebar-border pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" />
              {lang === "en" ? "Photo" : "ფოტო"}
              {sideData.designImage && <span className="ml-auto text-[10px] font-normal text-blue-500">● {lang === "en" ? "Blue handles" : "ლურჯი"}</span>}
            </h3>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            <Button variant="outline" className="w-full h-20 border-dashed" onClick={() => fileInputRef.current?.click()}>
              <div className="flex flex-col items-center gap-1">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {lang === "en" ? "Upload image" : "ატვირთეთ სურათი"}
                </span>
              </div>
            </Button>
            {sideData.designImage && (
              <div className="relative inline-block">
                <img src={sideData.designImage} alt="design" className="h-20 w-20 rounded-lg object-cover border border-border" />
                <button
                  onClick={() => updateField("designImage", null)}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground h-5 w-5 flex items-center justify-center"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Text input */}
          <div className="border-t border-sidebar-border pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Type className="h-3.5 w-3.5" />
              {lang === "en" ? "Text" : "ტექსტი"}
              {sideData.designText.trim() && <span className="ml-auto text-[10px] font-normal text-emerald-500">● {lang === "en" ? "Green handles" : "მწვანე"}</span>}
            </h3>
            <Input
              value={sideData.designText}
              onChange={(e) => updateField("designText", e.target.value)}
              placeholder={lang === "en" ? "Enter your text..." : "შეიყვანეთ ტექსტი..."}
              className="bg-card"
            />

            {/* Font picker */}
            <div className="relative">
              <button
                onClick={() => setFontPickerOpen(!fontPickerOpen)}
                className="w-full flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm hover:border-primary/50 transition-colors"
              >
                <span style={{ fontFamily: sideData.selectedFont.family }}>{sideData.selectedFont.name}</span>
                <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${fontPickerOpen ? "rotate-180" : ""}`} />
              </button>
              {fontPickerOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-60 overflow-y-auto">
                  {FONTS.map((font) => (
                    <button
                      key={font.name}
                      onClick={() => { updateField("selectedFont", font); setFontPickerOpen(false); }}
                      className={`w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                        sideData.selectedFont.name === font.name ? "bg-accent text-accent-foreground" : "text-popover-foreground"
                      }`}
                    >
                      <span style={{ fontFamily: font.family, fontSize: "15px" }}>{font.name}</span>
                      <span style={{ fontFamily: font.family }} className="text-muted-foreground text-xs">
                        AaBb აბ
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Text color picker */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Palette className="h-3 w-3" />
                {lang === "en" ? "Text Color" : "ტექსტის ფერი"}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color.hex}
                    onClick={() => updateField("textColor", color.hex)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                      sideData.textColor === color.hex ? "border-primary scale-110 ring-2 ring-primary/30" : "border-border"
                    }`}
                    style={{ backgroundColor: color.hex }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>

          {(sideData.designImage || sideData.designText.trim()) && (
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
          layers={layers.length > 0 ? layers : undefined}
        />
      </main>
    </div>
  );
}
