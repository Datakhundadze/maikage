import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview, { type DesignLayer } from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Type, X, Sparkles, ChevronDown, Palette, Plus, Globe, ShoppingBag } from "lucide-react";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, COLOR_FILTERS, BRAND_SIZES, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import { useAnalytics } from "@/hooks/useAnalytics";
import { calculatePrice, type BackType } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getGuestSessionId } from "@/lib/guestSession";
import PriceDisplay from "@/components/PriceDisplay";
import OrderDialog from "@/components/OrderDialog";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import ContactBar from "@/components/ContactBar";
import AppHeader from "@/components/AppHeader";

const FONT_GROUPS = [
  {
    label: "ქართული ფონტები",
    fonts: [
      { name: "Noto Sans Georgian", family: "'Noto Sans Georgian', sans-serif" },
      { name: "Noto Serif Georgian", family: "'Noto Serif Georgian', serif" },
      { name: "BPG Arial", family: "'BPG Arial', sans-serif" },
      { name: "FiraGO", family: "'FiraGO', sans-serif" },
    ],
  },
  {
    label: "ინგლისური Sans",
    fonts: [
      { name: "Roboto", family: "'Roboto', sans-serif" },
      { name: "Open Sans", family: "'Open Sans', sans-serif" },
      { name: "Montserrat", family: "'Montserrat', sans-serif" },
      { name: "Oswald", family: "'Oswald', sans-serif" },
      { name: "Raleway", family: "'Raleway', sans-serif" },
      { name: "Arial", family: "Arial, sans-serif" },
      { name: "Verdana", family: "Verdana, sans-serif" },
      { name: "Tahoma", family: "Tahoma, sans-serif" },
    ],
  },
  {
    label: "ინგლისური Serif",
    fonts: [
      { name: "Playfair Display", family: "'Playfair Display', serif" },
      { name: "Merriweather", family: "'Merriweather', serif" },
      { name: "Garamond", family: "'Garamond', serif" },
      { name: "Times New Roman", family: "'Times New Roman', serif" },
    ],
  },
  {
    label: "სათაური / Display",
    fonts: [
      { name: "Impact", family: "Impact, sans-serif" },
      { name: "Anton", family: "'Anton', Impact, sans-serif" },
      { name: "Bebas Neue", family: "'Bebas Neue', Impact, sans-serif" },
    ],
  },
  {
    label: "Script / Mono",
    fonts: [
      { name: "Dancing Script", family: "'Dancing Script', cursive" },
      { name: "Pacifico", family: "'Pacifico', cursive" },
      { name: "Brush Script", family: "'Brush Script MT', cursive" },
      { name: "Monospace", family: "'Courier New', monospace" },
    ],
  },
];

const FONTS = FONT_GROUPS.flatMap((g) => g.fonts);

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

function drawMultilineText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  fontFamily: string,
  color: string,
  maxFontSize: number,
) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return;

  const longestLine = lines.reduce((a, b) => (a.length > b.length ? a : b), "");
  const fontSize = Math.min(maxFontSize, maxWidth / (longestLine.length * 0.55));
  const lineHeight = fontSize * 1.25;
  const totalHeight = lineHeight * lines.length;

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${fontSize}px ${fontFamily}`;

  const startY = cy - totalHeight / 2 + lineHeight / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, startY + i * lineHeight, maxWidth);
  }
}

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

// Build a human-readable, copyable summary of the user's text so the admin
// can see the exact text, font, and color without reading it off the mockup.
function buildTextPrompt(front: SideData, back: SideData): string | null {
  const parts: string[] = [];
  const fmt = (label: string, s: SideData) => {
    if (!s.designText.trim()) return;
    parts.push(
      `${label}:\n` +
        `  ტექსტი: ${s.designText}\n` +
        `  ფონტი: ${s.selectedFont.family}\n` +
        `  ფერი: ${s.textColor}`
    );
  };
  fmt("წინა მხარე", front);
  fmt("უკანა მხარე", back);
  return parts.length ? parts.join("\n\n") : null;
}

const DEFAULT_PHOTO_COORDS: PlacementCoords = { x: 0.5, y: 0.5, scale: 1, scaleY: 1 };

// Compute initial photo coords so the image fits exactly inside the zone
// (no letterbox, no overflow) — preview matches export.
function fitCoordsToZone(
  imgW: number,
  imgH: number,
  zoneW: number,
  zoneH: number,
): PlacementCoords {
  if (imgW <= 0 || imgH <= 0 || zoneW <= 0 || zoneH <= 0) {
    return { ...DEFAULT_PHOTO_COORDS };
  }
  const imgAspect = imgW / imgH;
  const zoneAspect = zoneW / zoneH;
  let scale: number;
  let scaleY: number;
  if (imgAspect >= zoneAspect) {
    scale = 1;
    scaleY = zoneAspect / imgAspect;
  } else {
    scaleY = 1;
    scale = imgAspect / zoneAspect;
  }
  return { x: 0.5, y: 0.5, scale, scaleY };
}

const DEFAULT_SIDE: SideData = {
  photos: [],
  designText: "",
  selectedFont: FONTS[0],
  textColor: "#000000",
  textCoords: { x: 0.5, y: 0.65, scale: 0.4, scaleY: 0.12 },
};

let photoIdCounter = 0;

export default function SimplePage() {
  const { lang, theme, toggleTheme, setMode } = useAppState();
  const productConfig = useProductConfig();
  const { trackEvent } = useAnalytics();
  const { user } = useAuth();
  const { saveDesign, togglePublish } = useDesignStorage();
  const { addItem: addToCart, adding: addingToCart } = useCart();
  const { toast } = useToast();

  const [publishing, setPublishing] = useState(false);
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [sizeError, setSizeError] = useState(false);
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
      const probe = new Image();
      probe.onload = () => {
        const { config } = productConfig;
        const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
        const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, config.view);
        const zone = imageResult?.entry.placementZone;
        const zoneW = zone?.scale ?? 1;
        const zoneH = zone?.scaleY ?? zone?.scale ?? 1;
        const coords = fitCoordsToZone(probe.naturalWidth, probe.naturalHeight, zoneW, zoneH);
        setSideData(prev => {
          if (prev.photos.length >= MAX_PHOTOS) return prev;
          const newPhoto: PhotoLayer = {
            id: `photo-${++photoIdCounter}`,
            image: result,
            coords,
          };
          return { ...prev, photos: [...prev.photos, newPhoto] };
        });
      };
      probe.onerror = () => {
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
      probe.src = result;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [setSideData, productConfig]);

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

  // Generate text as a transparent canvas image (supports multiline via \n)
  const [textImage, setTextImage] = useState<string | null>(null);
  useEffect(() => {
    if (!sideData.designText.trim()) {
      setTextImage(null);
      return;
    }
    document.fonts.ready.then(() => {
      const lines = sideData.designText.split("\n").filter((l) => l.trim());
      const lineCount = Math.max(lines.length, 1);
      const canvasH = Math.max(200, lineCount * 120);
      const canvas = document.createElement("canvas");
      canvas.width = 800;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, 800, canvasH);
      drawMultilineText(ctx, sideData.designText, 400, canvasH / 2, 760, sideData.selectedFont.family, sideData.textColor, 120);
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
    const needsColorFilter = imageResult ? !imageResult.isExact : false;
    const zone = imageResult?.entry.placementZone;

    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d")!;

    // Draw product base (apply color filter if using a white base for a non-white color)
    if (baseImageUrl) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = baseImageUrl;
        });
        if (needsColorFilter) {
          const colorFilter = COLOR_FILTERS[config.color as ProductColor];
          if (colorFilter) ctx.filter = colorFilter;
        }
        ctx.drawImage(img, 0, 0, 800, 800);
        ctx.filter = "none";
      } catch {
        ctx.fillStyle = "#f0f0f0";
        ctx.fillRect(0, 0, 800, 800);
      }
    } else {
      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, 800, 800);
    }

    // Clip drawing to the placement zone so design never overflows the product
    const zoneW = zone ? 800 * zone.scale : 800;
    const zoneH = zone ? 800 * (zone.scaleY ?? zone.scale) : 800;
    const zoneX = zone ? 800 * zone.x - zoneW / 2 : 0;
    const zoneY = zone ? 800 * zone.y - zoneH / 2 : 0;

    ctx.save();
    if (zone) {
      ctx.beginPath();
      ctx.rect(zoneX, zoneY, zoneW, zoneH);
      ctx.clip();
    }

    // Draw photo layers (constrained within placement zone)
    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        // Photo box: the bounding box the user sees/drags in the preview
        const boxW = zoneW * photo.coords.scale;
        const boxH = zoneH * (photo.coords.scaleY ?? photo.coords.scale);
        const boxX = zoneX + zoneW * photo.coords.x - boxW / 2;
        const boxY = zoneY + zoneH * photo.coords.y - boxH / 2;
        // object-contain: fit image inside box, preserve aspect ratio
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = boxW / boxH;
        let pw: number, ph: number;
        if (imgAspect > boxAspect) {
          pw = boxW;
          ph = boxW / imgAspect;
        } else {
          ph = boxH;
          pw = boxH * imgAspect;
        }
        const px = boxX + (boxW - pw) / 2;
        const py = boxY + (boxH - ph) / 2;
        ctx.globalAlpha = 0.8;
        ctx.drawImage(img, px, py, pw, ph);
        ctx.globalAlpha = 1;
      } catch { /* skip */ }
    }

    // Draw text (multiline, constrained to zone width)
    if (side.designText.trim()) {
      const tc = side.textCoords;
      const maxTextWidth = zoneW * 0.95;
      const tx = zoneX + zoneW * tc.x;
      const ty = zoneY + zoneH * tc.y;
      drawMultilineText(ctx, side.designText, tx, ty, maxTextWidth, side.selectedFont.family, side.textColor, 80);
    }

    ctx.restore();

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Composite design-only (photos + text on transparent background, no product)
  // Used as the "print file" saved alongside the full mockup.
  // Output is cropped to the placement zone and rendered at high resolution
  // so admin downloads are print-quality regardless of how small the zone is
  // relative to the mockup canvas.
  const compositeDesignOnly = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !side.designText.trim()) return null;

    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, view);
    const zone = imageResult?.entry.placementZone;

    // Canvas represents just the printable zone (cropped), scaled up for print quality.
    const PRINT_SIZE = 3000;
    const aspect = zone ? (zone.scaleY ?? zone.scale) / zone.scale : 1;
    const canvasW = PRINT_SIZE;
    const canvasH = Math.round(PRINT_SIZE * aspect);

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;

    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        const boxW = canvasW * photo.coords.scale;
        const boxH = canvasH * (photo.coords.scaleY ?? photo.coords.scale);
        const boxX = canvasW * photo.coords.x - boxW / 2;
        const boxY = canvasH * photo.coords.y - boxH / 2;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = boxW / boxH;
        let pw: number, ph: number;
        if (imgAspect > boxAspect) {
          pw = boxW;
          ph = boxW / imgAspect;
        } else {
          ph = boxH;
          pw = boxH * imgAspect;
        }
        const px = boxX + (boxW - pw) / 2;
        const py = boxY + (boxH - ph) / 2;
        ctx.drawImage(img, px, py, pw, ph);
      } catch { /* skip */ }
    }

    if (side.designText.trim()) {
      const tc = side.textCoords;
      const maxTextWidth = canvasW * 0.95;
      const tx = canvasW * tc.x;
      const ty = canvasH * tc.y;
      // Scale the text font size proportionally (was 80px on 800px = 10% of canvas width)
      const fontPx = Math.round(canvasW * 0.1);
      drawMultilineText(ctx, side.designText, tx, ty, maxTextWidth, side.selectedFont.family, side.textColor, fontPx);
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Save Simple mode design to generations table
  const saveToGenerations = useCallback(async (frontMockup: string | null, backMockup: string | null, designOnly: string | null) => {
    if (savedToGenerations) return;
    try {
      const { config } = productConfig;
      const genId = crypto.randomUUID();
      const imageData = frontMockup || backMockup;

      // Upload mockup image
      let mockupPath: string | null = null;
      if (imageData) {
        const blob = await fetch(imageData).then(r => r.blob());
        const path = `generations/${genId}-mockup.png`;
        const { error: upErr } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
        if (!upErr) mockupPath = path;
      }

      // Upload design-only (transparent) image — this is the print file
      let transparentPath: string | null = null;
      if (designOnly) {
        const blob = await fetch(designOnly).then(r => r.blob());
        const path = `generations/${genId}-transparent.png`;
        const { error: upErr } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
        if (!upErr) transparentPath = path;
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
        transparent_image_path: transparentPath,
      };
      await supabase.from("generations" as any).insert(record);
      setSavedToGenerations(true);
    } catch (e) {
      console.error("[Simple] Failed to save generation:", e);
    }
  }, [user, productConfig, savedToGenerations]);

  const handlePublish = useCallback(async (frontMockupUrl: string | null) => {
    if (!user) { return; }
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
  const [frontDesignOnly, setFrontDesignOnly] = useState<string | null>(null);
  const [backDesignOnly, setBackDesignOnly] = useState<string | null>(null);

  // Generate mockups when design changes
  useEffect(() => {
    const hasFrontDesign = frontData.photos.length > 0 || frontData.designText.trim();
    const hasBackDesign = backData.photos.length > 0 || backData.designText.trim();

    if (hasFrontDesign) {
      compositeSide(frontData, "front").then(setFrontMockup);
      compositeDesignOnly(frontData, "front").then(setFrontDesignOnly);
    } else {
      setFrontMockup(null);
      setFrontDesignOnly(null);
    }
    if (hasBackDesign) {
      compositeSide(backData, "back").then(setBackMockup);
      compositeDesignOnly(backData, "back").then(setBackDesignOnly);
    } else {
      setBackMockup(null);
      setBackDesignOnly(null);
    }
    setSavedToGenerations(false);
  }, [frontData, backData, productConfig.config.product, productConfig.config.subProduct, productConfig.config.color]);

  return (
    <div className="flex flex-col h-screen">
      <AppHeader />
      <ContactBar />
      {/* Sidebar + Main wrapper */}
      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="w-full lg:w-[450px] lg:min-w-[450px] shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border lg:overflow-hidden">

        <div className="overflow-y-auto flex-1 p-4 space-y-6">
          {/* Product config */}
          <ProductConfigPanel
            config={productConfig.config}
            locked={false}
            onProductChange={(p) => { productConfig.setProduct(p); setSizeError(false); }}
            onSubProductChange={(s) => { productConfig.setSubProduct(s); setSizeError(false); }}
            onColorChange={productConfig.setColor}
            onViewChange={productConfig.setView}
            selectedSize={productConfig.config.size}
            onSizeChange={(s) => { productConfig.setSize(s); setSizeError(false); }}
            sizeError={sizeError}
          />

          {/* Mobile-only inline preview — below view buttons, same as Studio mode */}
          <div className="lg:hidden rounded-xl overflow-hidden border border-border bg-background">
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
          </div>

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
            </h3>
            <Textarea
              value={sideData.designText}
              onChange={(e) => updateField("designText", e.target.value)}
              placeholder={lang === "en" ? "Enter your text..." : "შეიყვანეთ ტექსტი..."}
              className="bg-card resize-none"
              rows={2}
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
                <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-64 overflow-y-auto">
                  {FONT_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="px-3 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/50 sticky top-0">
                        {group.label}
                      </div>
                      {group.fonts.map((font) => (
                        <button
                          key={font.name}
                          onClick={() => { updateField("selectedFont", font); setFontPickerOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                            sideData.selectedFont.name === font.name ? "bg-accent text-accent-foreground" : "text-popover-foreground"
                          }`}
                        >
                          <span style={{ fontFamily: font.family, fontSize: "14px" }}>{font.name}</span>
                          <span style={{ fontFamily: font.family }} className="text-muted-foreground text-xs">
                            AaBb აბ
                          </span>
                        </button>
                      ))}
                    </div>
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
                {(() => {
                  const needsSize = (BRAND_SIZES[productConfig.config.subProduct]?.length > 0) || productConfig.config.product === "Phone Case";
                  const handleOrderClick = () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    if (frontMockup || backMockup) saveToGenerations(frontMockup, backMockup, frontDesignOnly || backDesignOnly);
                    setOrderDialogOpen(true);
                  };
                  const handleAddToCart = async () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    if (!frontMockup && !backMockup) {
                      toast({ title: "ჯერ შექმენი დიზაინი", variant: "destructive" });
                      return;
                    }
                    try {
                      await addToCart({
                        product: productConfig.config.product,
                        subProduct: productConfig.config.subProduct,
                        color: productConfig.config.color,
                        size: productConfig.config.size || null,
                        isStudio: false,
                        frontMockupDataUrl: frontMockup,
                        backMockupDataUrl: backMockup,
                        transparentImageDataUrl: frontDesignOnly,
                        backTransparentImageDataUrl: backDesignOnly,
                        frontOriginalPhotos: frontData.photos.map(p => p.image),
                        backOriginalPhotos: backData.photos.map(p => p.image),
                        prompt: buildTextPrompt(frontData, backData),
                        productPrice: breakdown.total,
                      });
                      toast({ title: "კალათაში დაემატა ✓" });
                    } catch (e: any) {
                      toast({ title: "შეცდომა", description: e.message, variant: "destructive" });
                    }
                  };
                  return (
                    <>
                      <Button
                        className="w-full h-12 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold text-base"
                        onClick={handleOrderClick}
                      >
                        <ShoppingBag className="h-5 w-5" />
                        შეკვეთა
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full h-11 gap-2 font-semibold text-sm"
                        onClick={handleAddToCart}
                        disabled={addingToCart}
                      >
                        <ShoppingBag className="h-4 w-4" />
                        {addingToCart ? "ემატება..." : "კალათაში დამატება"}
                      </Button>
                      <OrderDialog
                        breakdown={breakdown}
                        product={productConfig.config.product}
                        subProduct={productConfig.config.subProduct}
                        color={productConfig.config.color}
                        isStudio={false}
                        externalOpen={orderDialogOpen}
                        onExternalOpenChange={setOrderDialogOpen}
                        frontMockupDataUrl={frontMockup}
                        backMockupDataUrl={backMockup}
                        transparentImageDataUrl={frontDesignOnly}
                        backTransparentImageDataUrl={backDesignOnly}
                        frontOriginalPhotos={frontData.photos.map(p => p.image)}
                        backOriginalPhotos={backData.photos.map(p => p.image)}
                        size={productConfig.config.size}
                        prompt={buildTextPrompt(frontData, backData)}
                      >
                        <span className="hidden" />
                      </OrderDialog>
                    </>
                  );
                })()}
                {/* Quick actions */}
                {(frontMockup || backMockup) && (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => handlePublish(frontMockup!)} disabled={publishing} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-primary border border-primary/30 hover:bg-primary/10 transition-colors disabled:opacity-50">
                      <Globe className="h-3.5 w-3.5" /> {publishing ? "..." : (lang === "en" ? "Publish" : "გამოქვეყნება")}
                    </button>
                  </div>
                )}
              </>
            );
          })()}

        </div>

        {/* Footer: AI Studio + theme switcher */}
        <div className="shrink-0 border-t border-sidebar-border p-3 flex items-center gap-2">
          <button
            onClick={() => setMode("studio")}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sidebar-accent border border-sidebar-border hover:opacity-90 text-sidebar-foreground font-semibold text-sm py-2.5 transition-all"
          >
            <Sparkles className="h-4 w-4" />
            {lang === "en" ? "AI Studio" : "AI სტუდია"}
          </button>
          <div className="flex items-center gap-1.5 px-2">
            <button
              onClick={() => theme !== "dark" && toggleTheme()}
              className={`h-5 w-5 rounded-full bg-black border transition-all ${theme === "dark" ? "border-white/50 ring-2 ring-white/30 scale-110" : "border-white/20 opacity-50 hover:opacity-80"}`}
              title="Dark"
            />
            <button
              onClick={() => theme !== "green" && toggleTheme()}
              className={`h-5 w-5 rounded-full bg-[#25B988] transition-all ${theme === "green" ? "ring-2 ring-[#25B988]/60 scale-110" : "opacity-50 hover:opacity-80"}`}
              title="Green"
            />
          </div>
        </div>
      </aside>

      {/* Main preview — desktop only; mobile uses inline preview in sidebar */}
      <main className="hidden lg:flex flex-1 bg-background overflow-y-auto flex-col">
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
    </div>
  );
}
