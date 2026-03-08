import { useState, useRef, useCallback } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Type, X, Sparkles } from "lucide-react";

export default function SimplePage() {
  const { lang, toggleLang, theme, toggleTheme, setMode } = useAppState();
  const productConfig = useProductConfig();
  const [designImage, setDesignImage] = useState<string | null>(null);
  const [designText, setDesignText] = useState("");
  const [activeTab, setActiveTab] = useState<"photo" | "text">("photo");
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

  // Generate a simple text image on canvas
  const textImageDataUrl = (() => {
    if (activeTab !== "text" || !designText.trim()) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "transparent";
    ctx.clearRect(0, 0, 400, 400);
    ctx.fillStyle = "#000000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.min(60, 400 / (designText.length * 0.6));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(designText, 200, 200, 380);
    return canvas.toDataURL("image/png");
  })();

  const currentDesignImage = activeTab === "photo" ? designImage : textImageDataUrl;

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

          {/* Design input */}
          <div className="border-t border-sidebar-border pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-card-foreground">
              {lang === "en" ? "Your Design" : "თქვენი დიზაინი"}
            </h3>

            {/* Tab toggle */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={activeTab === "photo" ? "default" : "outline"}
                className={activeTab === "photo" ? "bg-primary text-primary-foreground" : ""}
                onClick={() => setActiveTab("photo")}
              >
                <Upload className="h-3.5 w-3.5 mr-1" />
                {lang === "en" ? "Photo" : "ფოტო"}
              </Button>
              <Button
                size="sm"
                variant={activeTab === "text" ? "default" : "outline"}
                className={activeTab === "text" ? "bg-primary text-primary-foreground" : ""}
                onClick={() => setActiveTab("text")}
              >
                <Type className="h-3.5 w-3.5 mr-1" />
                {lang === "en" ? "Text" : "ტექსტი"}
              </Button>
            </div>

            {activeTab === "photo" ? (
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
                  className="w-full h-24 border-dashed"
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
            ) : (
              <Input
                value={designText}
                onChange={(e) => setDesignText(e.target.value)}
                placeholder={lang === "en" ? "Enter your text..." : "შეიყვანეთ ტექსტი..."}
                className="bg-card"
              />
            )}

            {currentDesignImage && (
              <Button variant="outline" size="sm" onClick={clearDesign}>
                {lang === "en" ? "Clear" : "გასუფთავება"}
              </Button>
            )}
          </div>
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
