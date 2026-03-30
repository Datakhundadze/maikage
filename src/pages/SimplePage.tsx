import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview, { type DesignLayer } from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, Type, X, Sparkles, ChevronDown, Palette, Plus, LogIn, LogOut, FolderOpen, Globe, Shirt } from "lucide-react";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import { useAnalytics } from "@/hooks/useAnalytics";
import { calculatePrice, type BackType } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getGuestSessionId } from "@/lib/guestSession";
import PriceDisplay from "@/components/PriceDisplay";
import OrderDialog from "@/components/OrderDialog";
import LoginModal from "@/components/LoginModal";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { useNavigate } from "react-router-dom";

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

const LAYER_COLORS = [
  "bg-blue-500",
  "bg-orange-500",
  "bg-cyan-500",
  "bg-rose-500",
  "bg-amber-500",
];

const MAX_PHOTOS = 5;

interface PhotoLayer {
  id: string;
  image: string;
  coords: PlacementCoords;
}

interface SideData {
  photos: PhotoLayer[];
  designText: string;
  selectedFont: typeof FONTS[0];
  textColor: string;
  textCoords: PlacementCoords;
}

const DEFAULT_PHOTO_COORDS: PlacementCoords = { x: 0.5, y: 0.38, scale: 0.35, scaleY: 0.35 };

const DEFAULT_SIDE: SideData = {
  photos: [],
  designText: "",
  selectedFont: FONTS[0],
  textColor: "#000000",
  textCoords: { x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 },
};

let photoIdCounter = 0;

export default function SimplePage() {
  const { lang, toggleLang, theme, toggleTheme, setMode } = useAppState();
  const productConfig = useProductConfig();
  const { trackEvent } = useAnalytics();
  const { user, isAnonymous, signOut } = useAuth();
  const { saveDesign, togglePublish } = useDesignStorage();
  const navigate = useNavigate();
  const [showLogin, setShowLogin] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    trackEvent("page_visit", { page: "simple" });
  }, [trackEvent]);

  // Track if generation was saved for current design session
  const [savedToGenerations, setSavedToGenerations] = useState(false);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

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
      setSideData(prev => {
        if (prev.photos.length >= MAX_PHOTOS) return prev;
        const newPhoto: PhotoLayer = {
          id: `photo-${++photoIdCounter}`,
          image: result,
          coords: { ...DEFAULT_PHOTO_COORDS },
        };
        return { ...prev, photos: [...prev.photos, newPhoto] };
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [setSideData]);

  const removePhoto = (id: string) => {
    setSideData(prev => ({
      ...prev,
      photos: prev.photos.filter(p => p.id !== id),
    }));
  };

  const updatePhotoCoords = useCallback((id: string, coords: PlacementCoords) => {
    setSideData(prev => ({
      ...prev,
      photos: prev.photos.map(p => p.id === id ? { ...p, coords } : p),
    }));
  }, [setSideData]);

  const clearDesign = () => {
    setSideData(prev => ({
      ...prev,
      photos: [],
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
    sideData.photos.forEach((photo, index) => {
      result.push({
        id: photo.id,
        image: photo.image,
        coords: photo.coords,
        onCoordsChange: (c) => updatePhotoCoords(photo.id, c),
        accentClass: LAYER_COLORS[index % LAYER_COLORS.length],
        selected: selectedLayerId === photo.id,
        onSelect: () => setSelectedLayerId(photo.id),
      });
    });
    if (textImage) {
      result.push({
        id: "text",
        image: textImage,
        coords: sideData.textCoords,
        onCoordsChange: (c) => setSideData(prev => ({ ...prev, textCoords: c })),
        accentClass: "bg-emerald-500",
        selected: selectedLayerId === "text",
        onSelect: () => setSelectedLayerId("text"),
      });
    }
    return result;
  }, [sideData.photos, textImage, sideData.textCoords, setSideData, updatePhotoCoords, selectedLayerId]);

  const hasPhotos = sideData.photos.length > 0;
  const canAddMore = sideData.photos.length < MAX_PHOTOS;

  // Composite layers onto product image for a given side
  const compositeSide = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !side.designText.trim()) return null;

    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, view);
    const baseImageUrl = imageResult?.entry.imageUrl ?? null;

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;

    // Draw product base
    if (baseImageUrl) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = baseImageUrl;
        });
        ctx.drawImage(img, 0, 0, 800, 800);
      } catch {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(0, 0, 800, 800);
      }
    } else {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, 800, 800);
    }

    // Draw photo layers
    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        const w = 800 * photo.coords.scale;
        const h = photo.coords.scaleY ? 800 * photo.coords.scaleY : (img.naturalHeight / img.naturalWidth) * w;
        const x = 800 * photo.coords.x - w / 2;
        const y = 800 * photo.coords.y - h / 2;
        ctx.globalAlpha = 0.8;
        ctx.drawImage(img, x, y, w, h);
        ctx.globalAlpha = 1;
      } catch { /* skip */ }
    }

    // Draw text
    if (side.designText.trim()) {
      const tc = side.textCoords;
      const fontSize = Math.min(80, 600 / (side.designText.length * 0.55));
      ctx.fillStyle = side.textColor;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${fontSize}px ${side.selectedFont.family}`;
      ctx.fillText(side.designText, 800 * tc.x, 800 * tc.y, 600);
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Save Simple mode design to generations table
  const saveToGenerations = useCallback(async (frontMockup: string | null, backMockup: string | null) => {
    if (savedToGenerations) return;
    try {
      const { config } = productConfig;
      const genId = crypto.randomUUID();
      const imageData = frontMockup || backMockup;

      // Upload image to storage (avoid storing large base64 in DB)
      let mockupPath: string | null = null;
      if (imageData) {
        const blob = await fetch(imageData).then(r => r.blob());
        const path = `generations/${genId}-mockup.png`;
        const { error: upErr } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
        if (!upErr) mockupPath = path;
      }

      const record = {
        user_id: user?.id ?? null,
        session_id: !user ? getGuestSessionId() : null,
        is_guest: !user,
        product: config.product,
        color: config.color,
        style: "simple",
        prompt: null,
        mockup_image_path: mockupPath,
        transparent_image_path: null,
      };
      await supabase.from("generations" as any).insert(record);
      setSavedToGenerations(true);
    } catch (e) {
      console.error("[Simple] Failed to save generation:", e);
    }
  }, [user, productConfig, savedToGenerations]);

  const handlePublish = useCallback(async (frontMockupUrl: string | null) => {
    if (!user) { setShowLogin(true); return; }
    if (!frontMockupUrl) return;
    setPublishing(true);
    const id = await saveDesign({
      title: "Simple Design",
      prompt: null,
      product: productConfig.config.product,
      color: productConfig.config.color,
      placementX: productConfig.config.placementCoords.x,
      placementY: productConfig.config.placementCoords.y,
      placementScale: productConfig.config.placementCoords.scale,
      transparentImageDataUrl: frontMockupUrl,
      mockupImageDataUrl: frontMockupUrl,
    });
    if (id) await togglePublish(id, false);
    setPublishing(false);
  }, [user, productConfig, saveDesign, togglePublish]);

  // Memoized mockup data URLs for order
  const [frontMockup, setFrontMockup] = useState<string | null>(null);
  const [backMockup, setBackMockup] = useState<string | null>(null);

  // Generate mockups when design changes
  useEffect(() => {
    const hasFrontDesign = frontData.photos.length > 0 || frontData.designText.trim();
    const hasBackDesign = backData.photos.length > 0 || backData.designText.trim();

    if (hasFrontDesign) {
      compositeSide(frontData, "front").then(setFrontMockup);
    } else {
      setFrontMockup(null);
    }
    if (hasBackDesign) {
      compositeSide(backData, "back").then(setBackMockup);
    } else {
      setBackMockup(null);
    }
    setSavedToGenerations(false);
  }, [frontData, backData, productConfig.config.product, productConfig.config.subProduct, productConfig.config.color]);

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:h-screen lg:overflow-y-auto">
        {/* Header */}
        <header className="flex flex-col gap-2 p-4 border-b border-sidebar-border">
          <div className="flex items-center justify-between">
            <button onClick={() => setMode("landing")} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background text-lg font-black dark:bg-primary dark:text-primary-foreground">
                M
              </div>
              <div className="text-left">
                <h1 className="text-xl font-bold leading-tight">maika.ge</h1>
                <div className="text-xs text-muted-foreground">{user?.email || (lang === "en" ? "Guest mode" : "სტუმრის რეჟიმი")}</div>
              </div>
            </button>
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
              {isAnonymous ? (
                <Button variant="ghost" size="sm" onClick={() => setShowLogin(true)} className="text-xs gap-1 px-2">
                  <LogIn className="h-3.5 w-3.5" /> შესვლა
                </Button>
              ) : (
                <Button variant="ghost" size="icon" onClick={() => signOut(setMode)} className="h-8 w-8" title="გასვლა">
                  <LogOut className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <nav className="flex gap-1">
            <button onClick={() => navigate("/my-designs")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <FolderOpen className="h-3.5 w-3.5" /> {lang === "en" ? "My Designs" : "ჩემი დიzaინები"}
            </button>
            <button onClick={() => navigate("/community")} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Globe className="h-3.5 w-3.5" /> {lang === "en" ? "Community" : "საზოგადოება"}
            </button>
            {frontMockup && (
              <button onClick={() => handlePublish(frontMockup)} disabled={publishing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-500 border border-amber-500/30 hover:bg-amber-500/10 transition-colors disabled:opacity-50">
                <Globe className="h-3.5 w-3.5" /> {publishing ? "..." : (lang === "en" ? "Publish" : "გამოქვეყნება")}
              </button>
            )}
            {frontMockup && (
              <button
                onClick={() => navigate("/try-on", { state: { mockupImage: frontMockup, transparentImage: frontMockup, productName: productConfig.config.product } })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-400 border border-purple-500/30 hover:bg-purple-500/10 transition-colors"
              >
                <Shirt className="h-3.5 w-3.5" /> {lang === "en" ? "Try On" : "გასინჯვა"}
              </button>
            )}
          </nav>
        </header>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Product config */}
          <ProductConfigPanel
            config={productConfig.config}
            locked={false}
            onProductChange={productConfig.setProduct}
            onSubProductChange={productConfig.setSubProduct}
            onColorChange={productConfig.setColor}
            onViewChange={productConfig.setView}
            selectedSize={productConfig.config.size}
            onSizeChange={productConfig.setSize}
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
              {lang === "en" ? "Photos" : "ფოტოები"}
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                {sideData.photos.length}/{MAX_PHOTOS}
              </span>
            </h3>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />

            {/* Photo thumbnails */}
            {hasPhotos && (
              <div className="flex flex-wrap gap-2">
                {sideData.photos.map((photo, index) => (
                  <div key={photo.id} className="relative group">
                    <div className={`absolute -top-1 -left-1 h-4 w-4 rounded-full ${LAYER_COLORS[index % LAYER_COLORS.length]} flex items-center justify-center z-10`}>
                      <span className="text-[9px] text-white font-bold">{index + 1}</span>
                    </div>
                    <img
                      src={photo.image}
                      alt={`photo ${index + 1}`}
                      className="h-16 w-16 rounded-lg object-cover border border-border"
                    />
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload / Add more button */}
            {canAddMore && (
              <Button
                variant="outline"
                className={`w-full ${hasPhotos ? "h-10" : "h-20"} border-dashed`}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex items-center gap-2">
                  {hasPhotos ? (
                    <>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {lang === "en" ? "Add another photo" : "დაამატეთ ფოტო"}
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {lang === "en" ? "Upload image" : "ატვირთეთ სურათი"}
                      </span>
                    </div>
                  )}
                </div>
              </Button>
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

          {(hasPhotos || sideData.designText.trim()) && (
            <Button variant="outline" size="sm" onClick={clearDesign}>
              {lang === "en" ? "Clear all" : "გასუფთავება"}
            </Button>
          )}

          {/* Price Display & Order */}
          {(() => {
            const backType: BackType = backData.photos.length > 0
              ? "photo"
              : backData.designText.trim()
                ? "text"
                : "none";
            const breakdown = calculatePrice(
              productConfig.config.product,
              productConfig.config.subProduct,
              backType,
              false,
            );
            return (
              <>
                <PriceDisplay breakdown={breakdown} />
                <OrderDialog
                  breakdown={breakdown}
                  product={productConfig.config.product}
                  subProduct={productConfig.config.subProduct}
                  color={productConfig.config.color}
                  isStudio={false}
                  frontMockupDataUrl={frontMockup}
                  backMockupDataUrl={backMockup}
                  size={productConfig.config.size}
                  onBeforeOpen={() => {
                    if (frontMockup || backMockup) {
                      saveToGenerations(frontMockup, backMockup);
                    }
                  }}
                />
              </>
            );
          })()}
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
          onBackgroundClick={() => setSelectedLayerId(null)}
        />
      </main>
    </div>
  );
}
