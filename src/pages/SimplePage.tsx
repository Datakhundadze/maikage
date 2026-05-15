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
import { catalog, COLORS, BRAND_SIZES, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import type { DesignState, DesignStateSide } from "@/lib/designState";
import { useAnalytics } from "@/hooks/useAnalytics";
import { calculatePrice } from "@/lib/pricing";
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
import SeoHead from "@/components/SeoHead";

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

// Stable per-tab session id so all composite events from one customer's
// design session can be correlated when triaging an incident. Stored in
// sessionStorage so a page reload preserves the id across navigations.
function getCompositeSessionId(): string {
  try {
    if (typeof sessionStorage === "undefined") return "no-session";
    const KEY = "maika_composite_session_id";
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "no-session";
  }
}

// Fire-and-forget telemetry sink. Keeps console.warn for in-browser
// debugging and also persists the event to composite_events so a
// reproducible incident can be triaged from the DB. The insert is
// awaited only to attach an error log — we never block the compositor
// on it.
function logCompositeEvent(
  eventType: string,
  eventData: Record<string, unknown>,
) {
  console.warn("[composite-telemetry]", { function: eventType, ...eventData });
  // composite_events is a new table not yet in the generated Database
  // types — `as any` mirrors the pattern already used elsewhere for
  // schema-ahead-of-types inserts (see OrderDialog.tsx).
  void (supabase as any)
    .from("composite_events")
    .insert({
      session_id: getCompositeSessionId(),
      event_type: eventType,
      event_data: eventData,
    })
    .then((res: { error: { message: string } | null }) => {
      if (res?.error) {
        console.warn(
          "[composite-telemetry] insert failed:",
          res.error.message,
        );
      }
    });
}

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

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Minimum legible size. Scales with maxFontSize so the 3000px print
  // canvas keeps the floor at print resolution while the 800px preview
  // floor stays at 8 px.
  const MIN_FONT_SIZE = Math.max(8, maxFontSize * 0.1);

  // Measure the actual rendered width at maxFontSize with the user's font,
  // then shrink proportionally if the widest line exceeds maxWidth. The
  // previous heuristic (length * 0.55) underestimated Noto Sans Georgian's
  // wide glyphs, so long Georgian text rendered at full maxFontSize, then
  // got clipped by the placement-zone ctx.clip() — only the middle of the
  // string remained visible on the mockup.
  let fontSize = maxFontSize;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  let widest = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > widest) widest = w;
  }
  if (widest > maxWidth && widest > 0) {
    fontSize = Math.max(MIN_FONT_SIZE, fontSize * (maxWidth / widest));
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
  }
  if (fontSize <= MIN_FONT_SIZE && widest > maxWidth) {
    // At the floor and still too wide: fillText's maxWidth arg will squash
    // horizontally instead of clipping, so the user sees compressed text
    // rather than nothing. Surface a console warning for triage.
    console.warn(
      "[drawMultilineText] text still exceeds maxWidth at MIN_FONT_SIZE",
      { textPreview: text.slice(0, 30), maxWidth, fontSize, widest },
    );
  }

  const lineHeight = fontSize * 1.25;
  const totalHeight = lineHeight * lines.length;
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

// Build the structured editor state for persistence. Photo URLs start as
// null and are filled in by the order/cart submission flow once the
// originals upload completes.
function buildDesignStateInput(
  frontData: SideData,
  backData: SideData,
  product: string,
  subProduct: string,
  color: string,
): DesignState | null {
  const buildSide = (s: SideData, view: "front" | "back"): DesignStateSide | null => {
    if (s.photos.length === 0 && !s.designText.trim()) return null;
    const resolvedSub = subProduct || catalog.getDefaultSubProduct(product as ProductType);
    const imageResult = catalog.findImageForColor(product as ProductType, resolvedSub, color as ProductColor, view);
    const zone = imageResult?.entry.placementZone;
    return {
      side: view,
      photos: s.photos.map((p, i) => ({
        url: null,
        x: p.coords.x,
        y: p.coords.y,
        scale: p.coords.scale,
        scaleY: p.coords.scaleY ?? p.coords.scale,
        rotation: p.coords.rotation ?? 0,
        z_order: i,
      })),
      text: s.designText.trim()
        ? {
            content: s.designText,
            font: s.selectedFont.family,
            fontName: s.selectedFont.name,
            color: s.textColor,
            x: s.textCoords.x,
            y: s.textCoords.y,
            scale: s.textCoords.scale,
            scaleY: s.textCoords.scaleY ?? s.textCoords.scale,
            rotation: s.textCoords.rotation ?? 0,
          }
        : null,
      zone: {
        x: zone?.x ?? 0.5,
        y: zone?.y ?? 0.5,
        width: zone?.scale ?? 1,
        height: zone?.scaleY ?? zone?.scale ?? 1,
      },
    };
  };
  const front = buildSide(frontData, "front");
  const back = buildSide(backData, "back");
  if (!front && !back) return null;
  return { version: 1, front, back };
}

// Photo box always fills the full placement zone so the design occupies exactly
// the dashed rectangle. Image inside uses cover-fit (center-crop) for non-matching
// aspect ratios — preview matches export.
const DEFAULT_PHOTO_COORDS: PlacementCoords = { x: 0.5, y: 0.5, scale: 1, scaleY: 1 };

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
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);

  // Where the next uploaded photo will land (zone-relative). Defaults to
  // zone-fill, centred. The empty placement frame is wired to this so the
  // user can pre-position the upload by dragging the dashed box, and the
  // first uploaded photo lands exactly where they put it.
  const [nextPhotoCoords, setNextPhotoCoords] = useState<PlacementCoords>({
    x: 0.5, y: 0.5, scale: 1, scaleY: 1,
  });

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
          // Land at wherever the user dragged the empty placement frame
          // (or zone-fill default if they never moved it).
          coords: prev.photos.length === 0 ? { ...nextPhotoCoords } : { ...DEFAULT_PHOTO_COORDS },
        };
        return { ...prev, photos: [...prev.photos, newPhoto] };
      });
      // Auto-select the newly uploaded photo so the keyboard delete handler
      // can target it without extra clicks.
      setSelectedLayerId(`photo-${photoIdCounter}`);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [setSideData, nextPhotoCoords]);

  const removePhoto = (id: string) => {
    setSideData(prev => ({
      ...prev,
      photos: prev.photos.filter(p => p.id !== id),
    }));
    if (selectedLayerId === id) setSelectedLayerId(null);
  };

  // Pressing Delete or Backspace on a selected layer removes it. Skipped
  // when the focus is in a text input/textarea so the user can still edit
  // their text content normally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      if (!selectedLayerId) return;
      if (selectedLayerId === "text") {
        setSideData(prev => ({ ...prev, designText: "" }));
      } else {
        removePhoto(selectedLayerId);
      }
      setSelectedLayerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayerId]);

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

  // Wait for the user-selected font to actually be loaded before drawing
  // text on canvas. Without this the browser silently falls back to a system
  // font when canvas runs faster than the network request to fonts.googleapis,
  // which produced order mockups where the text either looked wrong or was so
  // small at fallback metrics that it was invisible at admin thumbnail size.
  const ensureFontReady = async (fontFamily: string) => {
    if (typeof document === "undefined" || !document.fonts) return;
    try {
      // Pull just the first family ("'Playfair Display', serif" → "Playfair Display").
      const first = fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (first) await (document as any).fonts.load(`bold 80px "${first}"`);
      await document.fonts.ready;
    } catch { /* fonts API best-effort */ }
  };

  // Composite layers onto product image for a given side
  const compositeSide = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !side.designText.trim()) return null;
    if (side.designText.trim()) await ensureFontReady(side.selectedFont.family);

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

    // Draw product base. For non-exact colors (e.g. GIORDANO Black uses the
     // White base image), tint with luminance-based RGB multiplication so the
     // composited mockup matches the live preview. Canvas CSS filters are
     // unreliable across browsers / image origins, so we manipulate pixels
     // directly — same logic as ProductPreview's colorizeImage().
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
         if (needsColorFilter) {
           const colorEntry = COLORS.find((c) => c.name === config.color);
           const baseHex = colorEntry?.hex ?? "#FFFFFF";
           // Pure black would zero out shadow detail; #1a1a1a preserves texture.
           const targetHex = config.color === "Black" ? "#1a1a1a" : baseHex;
           const r = parseInt(targetHex.slice(1, 3), 16);
           const g = parseInt(targetHex.slice(3, 5), 16);
           const b = parseInt(targetHex.slice(5, 7), 16);
           const imageData = ctx.getImageData(0, 0, 800, 800);
           const data = imageData.data;
           for (let i = 0; i < data.length; i += 4) {
             if (data[i + 3] === 0) continue;
             const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
             const t = lum / 255;
             data[i] = Math.round(r * t);
             data[i + 1] = Math.round(g * t);
             data[i + 2] = Math.round(b * t);
           }
           ctx.putImageData(imageData, 0, 0);
         }
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
        // object-cover: fill the box entirely, center-cropping the image so the
        // design occupies the full dashed zone area (no letterbox).
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = boxW / boxH;
        let srcX = 0, srcY = 0, srcW = img.naturalWidth, srcH = img.naturalHeight;
        if (imgAspect > boxAspect) {
          srcW = img.naturalHeight * boxAspect;
          srcX = (img.naturalWidth - srcW) / 2;
        } else {
          srcH = img.naturalWidth / boxAspect;
          srcY = (img.naturalHeight - srcH) / 2;
        }
        ctx.globalAlpha = 0.8;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, boxX, boxY, boxW, boxH);
        ctx.globalAlpha = 1;
      } catch { /* skip */ }
    }

    // [composite-telemetry] Captures the exact state the compositor sees
    // so a future incident can be triaged from composite_events without
    // depending on the customer's browser DevTools. Insert is fire-and-
    // forget; the compositor never blocks on it.
    {
      const tcX = side.textCoords.x;
      const tcY = side.textCoords.y;
      const txDiag = zoneX + zoneW * tcX;
      const fromLeftDiag = (txDiag - zoneX) * 2;
      const fromRightDiag = (zoneX + zoneW - txDiag) * 2;
      const maxTextWidth = Math.min(zoneW * 0.95, fromLeftDiag, fromRightDiag);
      logCompositeEvent("compositeSide", {
        side: view,
        hasPhotos: side.photos.length > 0,
        photoCount: side.photos.length,
        hasText: !!side.designText.trim(),
        textLength: side.designText.length,
        textPreview: side.designText.slice(0, 30),
        textCoordsX: tcX,
        textCoordsY: tcY,
        selectedFont: side.selectedFont,
        textColor: side.textColor,
        zoneX, zoneY, zoneW, zoneH,
        maxTextWidth,
        fontFaceReady:
          typeof document !== "undefined" && document.fonts
            ? document.fonts.check('bold 80px "Noto Sans Georgian"')
            : null,
        timestamp: Date.now(),
      });
    }

    // Draw text (multiline, constrained to zone width)
    if (side.designText.trim()) {
      const tc = side.textCoords;
      const tx = zoneX + zoneW * tc.x;
      const ty = zoneY + zoneH * tc.y;
      // Center-aligned text: width must fit within the canvas/zone given its
      // position, otherwise the side closer to the edge gets cropped.
      const fromLeft = (tx - zoneX) * 2;
      const fromRight = (zoneX + zoneW - tx) * 2;
      const maxTextWidth = Math.min(zoneW * 0.95, fromLeft, fromRight);
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
    if (side.designText.trim()) await ensureFontReady(side.selectedFont.family);

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
        // object-cover: fill the print area entirely, center-cropping the image.
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const boxAspect = boxW / boxH;
        let srcX = 0, srcY = 0, srcW = img.naturalWidth, srcH = img.naturalHeight;
        if (imgAspect > boxAspect) {
          srcW = img.naturalHeight * boxAspect;
          srcX = (img.naturalWidth - srcW) / 2;
        } else {
          srcH = img.naturalWidth / boxAspect;
          srcY = (img.naturalHeight - srcH) / 2;
        }
        ctx.drawImage(img, srcX, srcY, srcW, srcH, boxX, boxY, boxW, boxH);
      } catch { /* skip */ }
    }

    // [composite-telemetry] same as compositeSide above.
    {
      const tcX = side.textCoords.x;
      const tcY = side.textCoords.y;
      const txDiag = canvasW * tcX;
      const maxTextWidth = Math.min(
        canvasW * 0.95,
        txDiag * 2,
        (canvasW - txDiag) * 2,
      );
      logCompositeEvent("compositeDesignOnly", {
        side: view,
        hasPhotos: side.photos.length > 0,
        photoCount: side.photos.length,
        hasText: !!side.designText.trim(),
        textLength: side.designText.length,
        textPreview: side.designText.slice(0, 30),
        textCoordsX: tcX,
        textCoordsY: tcY,
        selectedFont: side.selectedFont,
        textColor: side.textColor,
        zoneX: 0,
        zoneY: 0,
        zoneW: canvasW,
        zoneH: canvasH,
        maxTextWidth,
        fontFaceReady:
          typeof document !== "undefined" && document.fonts
            ? document.fonts.check('bold 80px "Noto Sans Georgian"')
            : null,
        timestamp: Date.now(),
      });
    }

    if (side.designText.trim()) {
      const tc = side.textCoords;
      const tx = canvasW * tc.x;
      const ty = canvasH * tc.y;
      // Center-aligned text: width must fit within canvas given its position,
      // otherwise the side closer to the edge gets cropped on the print file.
      const maxTextWidth = Math.min(canvasW * 0.95, tx * 2, (canvasW - tx) * 2);
      // Scale the text font size proportionally (was 80px on 800px = 10% of canvas width)
      const fontPx = Math.round(canvasW * 0.1);
      drawMultilineText(ctx, side.designText, tx, ty, maxTextWidth, side.selectedFont.family, side.textColor, fontPx);
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Save Simple mode design to generations table
  const saveToGenerations = useCallback(async (frontMockup: string | null, backMockup: string | null, designOnly: string | null) => {
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
    } catch (e) {
      console.error("[Simple] Failed to save generation:", e);
    }
  }, [user, productConfig]);

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

  // Generate mockups when design changes — debounced so dragging stays
  // smooth. Each composite call rebuilds 800-3000 px canvases and emits
  // toDataURL strings, which is heavy enough to stutter every drag tick.
  // The live preview (DraggablePlacement layers) updates in real time
  // anyway, so the heavyweight composite only needs to run once the user
  // stops moving.
  useEffect(() => {
    const hasFrontDesign = frontData.photos.length > 0 || frontData.designText.trim();
    const hasBackDesign = backData.photos.length > 0 || backData.designText.trim();

    if (!hasFrontDesign) {
      setFrontMockup(null);
      setFrontDesignOnly(null);
    }
    if (!hasBackDesign) {
      setBackMockup(null);
      setBackDesignOnly(null);
    }

    if (!hasFrontDesign && !hasBackDesign) return;

    const timer = setTimeout(() => {
      if (hasFrontDesign) {
        compositeSide(frontData, "front").then(setFrontMockup);
        compositeDesignOnly(frontData, "front").then(setFrontDesignOnly);
      }
      if (hasBackDesign) {
        compositeSide(backData, "back").then(setBackMockup);
        compositeDesignOnly(backData, "back").then(setBackDesignOnly);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [frontData, backData, productConfig.config.product, productConfig.config.subProduct, productConfig.config.color]);

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title="ფოტო და ტექსტი მაისურზე — Maika.ge"
        description="ატვირთე საკუთარი ფოტო, დაამატე ტექსტი და დაბეჭდე უნიკალური მაისური Maika.ge-ზე."
      />
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
              placementCoords={hasPhotos || textImage ? productConfig.config.placementCoords : nextPhotoCoords}
              onCoordsChange={hasPhotos || textImage ? productConfig.setPlacementCoords : setNextPhotoCoords}
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
                      className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground h-5 w-5 flex items-center justify-center hover:scale-110 transition-transform"
                      aria-label="წაშლა"
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
            const hasFront = frontData.photos.length > 0 || !!frontData.designText.trim();
            const hasBack = backData.photos.length > 0 || !!backData.designText.trim();
            const breakdown = calculatePrice(
              productConfig.config.product,
              productConfig.config.subProduct,
              hasFront,
              hasBack,
              false,
            );
            return (
              <>
                <PriceDisplay breakdown={breakdown} />
                {(() => {
                  const needsSize = (BRAND_SIZES[productConfig.config.subProduct]?.length > 0) || productConfig.config.product === "Phone Case";
                  // Both buttons must use fresh composite output. The useEffect
                  // that populates frontMockup/backDesignOnly is debounced
                  // 250ms, so a quick click can race past stale state and ship
                  // a missing back print file. Re-compute synchronously here.
                  const computeFresh = async () => {
                    const hasFront = frontData.photos.length > 0 || frontData.designText.trim();
                    const hasBack = backData.photos.length > 0 || backData.designText.trim();
                    const [fm, bm, fdo, bdo] = await Promise.all([
                      hasFront ? compositeSide(frontData, "front") : Promise.resolve(null),
                      hasBack ? compositeSide(backData, "back") : Promise.resolve(null),
                      hasFront ? compositeDesignOnly(frontData, "front") : Promise.resolve(null),
                      hasBack ? compositeDesignOnly(backData, "back") : Promise.resolve(null),
                    ]);
                    setFrontMockup(fm);
                    setBackMockup(bm);
                    setFrontDesignOnly(fdo);
                    setBackDesignOnly(bdo);
                    return { fm, bm, fdo, bdo };
                  };

                  const handleOrderClick = async () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    const { fm, bm, fdo, bdo } = await computeFresh();
                    if (fm || bm) saveToGenerations(fm, bm, fdo || bdo);
                    setOrderDialogOpen(true);
                  };
                  const handleAddToCart = async () => {
                    if (needsSize && !productConfig.config.size) {
                      setSizeError(true);
                      document.getElementById("size-selector")?.scrollIntoView({ behavior: "smooth", block: "center" });
                      return;
                    }
                    setSizeError(false);
                    const { fm, bm, fdo, bdo } = await computeFresh();
                    if (!fm && !bm) {
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
                        frontMockupDataUrl: fm,
                        backMockupDataUrl: bm,
                        transparentImageDataUrl: fdo,
                        backTransparentImageDataUrl: bdo,
                        frontOriginalPhotos: frontData.photos.map(p => p.image),
                        backOriginalPhotos: backData.photos.map(p => p.image),
                        prompt: buildTextPrompt(frontData, backData),
                        productPrice: breakdown.total,
                        designState: buildDesignStateInput(
                          frontData,
                          backData,
                          productConfig.config.product,
                          productConfig.config.subProduct,
                          productConfig.config.color,
                        ),
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
                        designState={buildDesignStateInput(
                          frontData,
                          backData,
                          productConfig.config.product,
                          productConfig.config.subProduct,
                          productConfig.config.color,
                        )}
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
