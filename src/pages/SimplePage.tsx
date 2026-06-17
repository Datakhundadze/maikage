import { useState, useRef, useCallback, useMemo, useEffect, lazy, Suspense } from "react";
import { useAppState } from "@/hooks/useAppState";
import ProductConfigPanel from "@/components/ProductConfigPanel";
import ProductPreview, { type DesignLayer } from "@/components/ProductPreview";
import { useProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Upload, Type, X, Sparkles, ChevronDown, Palette, Plus, ShoppingBag } from "lucide-react";
import QuantityStepper from "@/components/QuantityStepper";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, BRAND_SIZES, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import type { DesignState, DesignStateSide } from "@/lib/designState";
import { useAnalytics } from "@/hooks/useAnalytics";
import { calculatePrice } from "@/lib/pricing";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { getGuestSessionId } from "@/lib/guestSession";
import PriceDisplay from "@/components/PriceDisplay";
// OrderDialog ships ~21 KB (radix dialog + form code) and never renders on
// initial paint — wait until the customer actually opens it.
const OrderDialog = lazy(() => import("@/components/OrderDialog"));
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import ContactBar from "@/components/ContactBar";
import AppHeader from "@/components/AppHeader";
import SeoHead from "@/components/SeoHead";
import { runGenerationPipeline, callGemini, RateLimitError } from "@/lib/generation";
import { useGenerationLimit } from "@/hooks/useGenerationLimit";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { getStyleOptions } from "@/lib/designStyles";
import { t } from "@/lib/i18n";
import type { AppStatus } from "@/hooks/useDesign";
import LoginModal from "@/components/LoginModal";
import SimpleAiPanel from "@/components/SimpleAiPanel";

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
): { overflow: boolean; fontSize: number; widest: number } {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { overflow: false, fontSize: 0, widest: 0 };

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
  const overflow = fontSize <= MIN_FONT_SIZE && widest > maxWidth;
  if (overflow) {
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
  return { overflow, fontSize, widest };
}

interface PhotoLayer {
  id: string;
  image: string;
  coords: PlacementCoords;
  /** Source image's natural width / height. Populated asynchronously
   *  after the photo loads; used by DraggablePlacement to lock corner
   *  resize to this aspect so dragging doesn't stretch the image. */
  naturalAspect?: number;
  /** Source-image crop / pan state, in zone fractions (same units as
   *  `coords.scale`). `sourceScale` is the source width; `sourceOffsetX/Y`
   *  is the source center offset from the window center. Undefined means
   *  cover-fit-centered (the editor renders that as the implicit default).
   *  Becomes defined once the customer drags an edge handle or pans. */
  sourceScale?: number;
  sourceOffsetX?: number;
  sourceOffsetY?: number;
}

// Render a photo layer onto a 2D canvas, honoring either the legacy
// cover-fit mode (no source state) or the new crop mode (source state
// present). zone* params are in canvas pixels; the photo's coords/source
// are interpreted as zone fractions. Rotation is applied around the
// window center. Caller controls ctx.globalAlpha.
function drawPhotoOntoCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  zoneX: number,
  zoneY: number,
  zoneW: number,
  zoneH: number,
  photo: {
    coords: PlacementCoords;
    sourceScale?: number;
    sourceOffsetX?: number;
    sourceOffsetY?: number;
  },
): void {
  const winW = zoneW * photo.coords.scale;
  const winH = zoneH * (photo.coords.scaleY ?? photo.coords.scale);
  const winCx = zoneX + zoneW * photo.coords.x;
  const winCy = zoneY + zoneH * photo.coords.y;
  const winX = winCx - winW / 2;
  const winY = winCy - winH / 2;
  const rotationDeg = photo.coords.rotation ?? 0;

  const hasCropState =
    photo.sourceScale !== undefined &&
    photo.sourceOffsetX !== undefined &&
    photo.sourceOffsetY !== undefined &&
    photo.sourceScale > 0 &&
    img.naturalWidth > 0 &&
    img.naturalHeight > 0;

  if (hasCropState) {
    // Source rect in canvas pixels (the image's "physical" placement on
    // the t-shirt mockup, independent of the window box).
    const naturalAspect = img.naturalWidth / img.naturalHeight;
    const srcW_canvas = zoneW * photo.sourceScale!;
    const srcH_canvas = srcW_canvas / naturalAspect;
    const srcCx_canvas = winCx + zoneW * photo.sourceOffsetX!;
    const srcCy_canvas = winCy + zoneH * photo.sourceOffsetY!;
    const srcX_canvas = srcCx_canvas - srcW_canvas / 2;
    const srcY_canvas = srcCy_canvas - srcH_canvas / 2;

    // Intersection of source rect with the window — that's what's
    // actually visible. Clip pre-rotation in window-space coordinates.
    const destX = Math.max(srcX_canvas, winX);
    const destY = Math.max(srcY_canvas, winY);
    const destR = Math.min(srcX_canvas + srcW_canvas, winX + winW);
    const destB = Math.min(srcY_canvas + srcH_canvas, winY + winH);
    const destW = destR - destX;
    const destH = destB - destY;
    if (destW <= 0 || destH <= 0) return;

    // Map the visible portion back to image-native pixel space.
    const sxFrac = (destX - srcX_canvas) / srcW_canvas;
    const syFrac = (destY - srcY_canvas) / srcH_canvas;
    const swFrac = destW / srcW_canvas;
    const shFrac = destH / srcH_canvas;
    const sx = sxFrac * img.naturalWidth;
    const sy = syFrac * img.naturalHeight;
    const sw = swFrac * img.naturalWidth;
    const sh = shFrac * img.naturalHeight;

    if (rotationDeg) {
      ctx.save();
      ctx.translate(winCx, winCy);
      ctx.rotate((rotationDeg * Math.PI) / 180);
      ctx.drawImage(img, sx, sy, sw, sh, destX - winCx, destY - winCy, destW, destH);
      ctx.restore();
    } else {
      ctx.drawImage(img, sx, sy, sw, sh, destX, destY, destW, destH);
    }
    return;
  }

  // Legacy cover-fit mode: center-crop the image to fill the window.
  // Matches the visual rendering of orders placed before crop UX shipped.
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const winAspect = winW / winH;
  let srcX = 0;
  let srcY = 0;
  let srcW = img.naturalWidth;
  let srcH = img.naturalHeight;
  if (imgAspect > winAspect) {
    srcW = img.naturalHeight * winAspect;
    srcX = (img.naturalWidth - srcW) / 2;
  } else {
    srcH = img.naturalWidth / winAspect;
    srcY = (img.naturalHeight - srcH) / 2;
  }
  if (rotationDeg) {
    ctx.save();
    ctx.translate(winCx, winCy);
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.drawImage(img, srcX, srcY, srcW, srcH, -winW / 2, -winH / 2, winW, winH);
    ctx.restore();
  } else {
    ctx.drawImage(img, srcX, srcY, srcW, srcH, winX, winY, winW, winH);
  }
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
        natural_aspect: p.naturalAspect,
        source_scale: p.sourceScale,
        source_offset_x: p.sourceOffsetX,
        source_offset_y: p.sourceOffsetY,
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

// The empty placement frame uses zone-fill so a first-time upload lands
// exactly where the dashed box sits. Subsequent uploads use a smaller box
// offset from center so the customer can see each new photo distinctly
// instead of having every upload completely cover the previous one
// (which is what zone-fill defaults caused).
const DEFAULT_PHOTO_COORDS: PlacementCoords = { x: 0.5, y: 0.5, scale: 1, scaleY: 1 };

// Stagger photos #2..#N at half size in a small diagonal so collisions are
// visible. Customer is expected to drag/resize from there.
function staggeredPhotoCoords(index: number): PlacementCoords {
  const step = 0.08;
  return {
    x: Math.min(0.95, Math.max(0.05, 0.5 + (index - 1) * step)),
    y: Math.min(0.95, Math.max(0.05, 0.5 + (index - 1) * step)),
    scale: 0.5,
    scaleY: 0.5,
  };
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
  const { addItem: addToCart, adding: addingToCart } = useCart();
  const { toast } = useToast();

  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const [sizeError, setSizeError] = useState(false);
  const [quantity, setQuantity] = useState<number>(1);
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

  // ── AI design (Phase 1) ──────────────────────────────────────────────
  // Guest quota = 2 (Studio keeps its default 5; shared hook is parameterized).
  const { checkLimit: checkAiLimit, recordGeneration: recordAiGeneration } = useGenerationLimit(2);
  const { saveDesign } = useDesignStorage();
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStyle, setAiStyle] = useState("");
  const [aiWithBackground, setAiWithBackground] = useState(false); // default: without background
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiStatus, setAiStatus] = useState<AppStatus>("GENERATING_DESIGN");
  // resultImage = shown in the panel; transferImage = injected as a layer.
  const [aiResult, setAiResult] = useState<{ resultImage: string; transferImage: string } | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginModalMessage, setLoginModalMessage] = useState<string | undefined>();
  const aiStyleOptions = getStyleOptions(lang);

  // Helpers to update current side
  const updateField = <K extends keyof SideData>(key: K, value: SideData[K]) => {
    setSideData(prev => ({ ...prev, [key]: value }));
  };

  // Resolve the placement zone for the current product/color/view so the
  // upload handler and the layer builder can derive contain / cover-fit
  // math in zone-fraction units. The zone aspect (not always square)
  // shows up because source `scale` is in zone-X-fraction terms.
  const zoneForLayers = useMemo(() => {
    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(
      config.product as ProductType,
      resolvedSub,
      config.color as ProductColor,
      currentView,
    );
    return imageResult?.entry.placementZone;
  }, [productConfig, currentView]);

  // Append a photo layer from a data URL. Used by BOTH the file upload and
  // the AI "transfer to product" action, so a generated design behaves
  // exactly like an uploaded photo — same default coords/zone, same async
  // contain-fit, same DraggablePlacement handles, same order/cart path.
  const addPhotoLayer = useCallback((dataUrl: string) => {
    const photoId = `photo-${++photoIdCounter}`;
    setSideData(prev => {
      if (prev.photos.length >= MAX_PHOTOS) return prev;
      const newPhoto: PhotoLayer = {
        id: photoId,
        image: dataUrl,
        // First photo: land at wherever the user dragged the empty
        // placement frame (or zone-fill default if they never moved it).
        // Subsequent photos: stagger at half-size so they don't cover
        // each other completely.
        coords:
          prev.photos.length === 0
            ? { ...nextPhotoCoords }
            : staggeredPhotoCoords(prev.photos.length),
      };
      return { ...prev, photos: [...prev.photos, newPhoto] };
    });
    // Auto-select the newly added photo so the keyboard delete handler
    // can target it without extra clicks.
    setSelectedLayerId(photoId);

    // Measure natural aspect asynchronously and apply CONTAIN-fit to the
    // photo's window so the entire image is visible by default — no
    // auto-crop, matching Canva / Figma / Photoshop behavior. Source state
    // is set explicitly so renderers skip the legacy cover-fit fallback.
    const probe = new Image();
    probe.onload = () => {
      if (!probe.naturalWidth || !probe.naturalHeight) return;
      const naturalAspect = probe.naturalWidth / probe.naturalHeight;
      const zoneW = zoneForLayers?.scale ?? 1;
      const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
      const zonePixelAspect = zoneW / zoneH;
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p => {
          if (p.id !== photoId) return p;
          const baseScale = p.coords.scale;
          const baseScaleY = p.coords.scaleY ?? p.coords.scale;
          let newScale: number;
          let newScaleY: number;
          if (naturalAspect >= zonePixelAspect) {
            newScale = baseScale;
            newScaleY = baseScale * zoneW / (naturalAspect * zoneH);
          } else {
            newScaleY = baseScaleY;
            newScale = baseScaleY * naturalAspect * zoneH / zoneW;
          }
          return {
            ...p,
            naturalAspect,
            coords: { ...p.coords, scale: newScale, scaleY: newScaleY },
            sourceScale: newScale,
            sourceOffsetX: 0,
            sourceOffsetY: 0,
          };
        }),
      }));
    };
    probe.src = dataUrl;
  }, [setSideData, nextPhotoCoords, zoneForLayers]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addPhotoLayer(reader.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  }, [addPhotoLayer]);

  // ── AI generation handlers ───────────────────────────────────────────
  const handleAiGenerate = useCallback(async () => {
    const text = aiPrompt.trim();
    if (!text || aiGenerating) return;
    const limit = checkAiLimit();
    if (!limit.allowed) {
      if ('reason' in limit && limit.reason === "guest_limit") {
        setLoginModalMessage('message' in limit ? limit.message : undefined);
        setShowLoginModal(true);
      }
      return;
    }
    setAiGenerating(true);
    setAiStatus("GENERATING_DESIGN");
    setAiResult(null);
    try {
      recordAiGeneration();
      const { config } = productConfig;
      const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
      const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, config.view);
      const productImageUrl = imageResult?.entry?.imageUrl ?? null;
      const isExactColor = imageResult?.isExact ?? false;
      const zone = imageResult?.entry?.placementZone;
      const placementCoords = config.placementCoords;
      const isRealistic = /realistic|photo|რეალ/i.test(aiStyle || "");

      let resultImage: string;
      let transferImage: string;
      let transparentImage: string | null;
      let mockupImage: string | null;

      if (!aiWithBackground) {
        // WITHOUT background → full existing pipeline incl. runTransparencyPipeline.
        const gen = await runGenerationPipeline(
          {
            designParams: { character: text, scene: "", style: aiStyle, text: "", characterImages: [], sceneImage: null, styleImage: null, textImage: null },
            product: config.product,
            color: config.color,
            speed: "fast",
          },
          placementCoords,
          productImageUrl,
          (s) => setAiStatus(s as AppStatus),
          isExactColor,
          zone,
        );
        resultImage = gen.mockupImage;
        transferImage = gen.transparentImage;
        transparentImage = gen.transparentImage;
        mockupImage = gen.mockupImage;
      } else {
        // WITH background → bare generate-design, SKIP the transparency stage.
        // Simple's own layer compositing places it on the product on transfer,
        // so no Stage-3 composite is needed here. The `isRealistic` flag (not a
        // style-string override) selects the verbatim realistic prompt branch
        // in the proxy — identical prompt to runGenerationPipeline's realistic path.
        const { image: rawImage } = await callGemini("generate-design", {
          character: text, scene: "", style: aiStyle, text: "",
          characterImages: [], sceneImage: null, styleImage: null, textImage: null,
          product: config.product, color: config.color,
          speed: isRealistic ? "pro" : "fast", isRealistic,
        });
        resultImage = rawImage;
        transferImage = rawImage;
        transparentImage = null;
        mockupImage = rawImage;
      }

      setAiResult({ resultImage, transferImage });

      // Analytics generations row — mirrors Studio's generation-time insert.
      void (async () => {
        try {
          const genId = crypto.randomUUID();
          const upload = async (dataUrl: string | null, suffix: string) => {
            if (!dataUrl) return null;
            const blob = await fetch(dataUrl).then(r => r.blob());
            const path = `generations/${genId}-${suffix}.png`;
            const { error } = await supabase.storage.from("designs").upload(path, blob, { contentType: "image/png" });
            return error ? null : path;
          };
          const [mockupPath, transparentPath] = await Promise.all([
            upload(mockupImage, "mockup"),
            upload(transparentImage, "transparent"),
          ]);
          await supabase.from("generations").insert({
            user_id: user?.id ?? null,
            session_id: !user ? getGuestSessionId() : null,
            is_guest: !user,
            product: config.product,
            color: config.color,
            style: aiStyle || "simple-ai",
            prompt: text,
            mockup_image_path: mockupPath,
            transparent_image_path: transparentPath,
          });
        } catch (e) {
          console.error("[Simple AI] generations insert failed:", e);
        }
      })();

      // Auto-save to "My Designs" (logged-in only; guests skip).
      if (user) {
        void saveDesign({
          title: text.slice(0, 60) || "AI Design",
          prompt: text,
          product: config.product,
          color: config.color,
          placementX: placementCoords.x,
          placementY: placementCoords.y,
          placementScale: placementCoords.scale,
          transparentImageDataUrl: transparentImage ?? transferImage,
          mockupImageDataUrl: mockupImage ?? transferImage,
        }).catch((e) => console.error("[Simple AI] My Designs save failed:", e));
      }

      trackEvent("design_generated", { product: config.product, mode: "simple-ai" });
    } catch (err) {
      // Server-side rate limit (429): anon → login modal, authed → toast.
      if (err instanceof RateLimitError) {
        if (err.requiresLogin) {
          setLoginModalMessage(t(lang, "rateLimit.signIn"));
          setShowLoginModal(true);
        } else {
          toast({ title: t(lang, "rateLimit.slowDownTitle"), description: t(lang, "rateLimit.slowDown") });
        }
      } else {
        toast({ title: t(lang, "simpleAi.error"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
      }
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, aiStyle, aiWithBackground, aiGenerating, checkAiLimit, recordAiGeneration, productConfig, user, saveDesign, trackEvent, toast, lang]);

  const handleAiTransfer = useCallback(() => {
    if (!aiResult) return;
    if (sideData.photos.length >= MAX_PHOTOS) {
      toast({ title: t(lang, "simpleAi.maxPhotos"), variant: "destructive" });
      return;
    }
    addPhotoLayer(aiResult.transferImage);
    toast({ title: t(lang, "simpleAi.transferred") });
  }, [aiResult, sideData.photos.length, addPhotoLayer, toast, lang]);

  const handleAiStartNew = useCallback(() => {
    setAiResult(null);
    setAiPrompt("");
  }, []);

  const handleAiDownload = useCallback(() => {
    if (!aiResult) return;
    const a = document.createElement("a");
    a.href = aiResult.resultImage;
    a.download = "maika-ai-design.png";
    a.click();
  }, [aiResult]);

  const aiTransferLabel = (() => {
    const p = productConfig.config.product;
    if (p === "T-Shirt") return t(lang, "simpleAi.transferTshirt");
    if (p === "Hoodie") return t(lang, "simpleAi.transferHoodie");
    if (p === "Tote Bag") return t(lang, "simpleAi.transferBag");
    return t(lang, "simpleAi.transferDefault");
  })();

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

  const updatePhotoSource = useCallback(
    (id: string, source: { scale: number; offsetX: number; offsetY: number }) => {
      setSideData(prev => ({
        ...prev,
        photos: prev.photos.map(p =>
          p.id === id
            ? {
                ...p,
                sourceScale: source.scale,
                sourceOffsetX: source.offsetX,
                sourceOffsetY: source.offsetY,
              }
            : p,
        ),
      }));
    },
    [setSideData],
  );

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

  // Initial cover-fit source state for a photo whose customer hasn't yet
  // dragged an edge handle / panned. Matches what `object-cover` does
  // visually: source covers the window, with the longer dimension
  // extending beyond. The compositors and live preview both treat
  // missing source state as equivalent to this default.
  const coverFitSource = useCallback(
    (photo: PhotoLayer): { scale: number; offsetX: number; offsetY: number } | undefined => {
      const naturalAspect = photo.naturalAspect;
      if (!naturalAspect || naturalAspect <= 0) return undefined;
      const zoneW = zoneForLayers?.scale ?? 1;
      const zoneH = zoneForLayers?.scaleY ?? zoneForLayers?.scale ?? 1;
      const winScale = photo.coords.scale;
      const winScaleY = photo.coords.scaleY ?? photo.coords.scale;
      // Box pixel aspect (assuming square parent): (winScale × zoneW) / (winScaleY × zoneH).
      const boxAspect = (winScale * zoneW) / (winScaleY * zoneH);
      let sourceScale: number;
      if (naturalAspect >= boxAspect) {
        // Image is wider than box: source matches box HEIGHT, extends horizontally.
        sourceScale = (winScaleY * zoneH * naturalAspect) / zoneW;
      } else {
        // Image is taller than box: source matches box WIDTH.
        sourceScale = winScale;
      }
      return { scale: sourceScale, offsetX: 0, offsetY: 0 };
    },
    [zoneForLayers],
  );

  // Build layers array
  const layers = useMemo<DesignLayer[]>(() => {
    const result: DesignLayer[] = [];
    sideData.photos.forEach((photo, index) => {
      // If the customer has already cropped/panned this photo we carry
      // those stored values through. Otherwise we synthesize a cover-fit
      // default so DraggablePlacement always has a defined source state
      // to drag from (without it, the first edge-drag would shift from 0).
      const storedSource =
        photo.sourceScale !== undefined && photo.sourceOffsetX !== undefined && photo.sourceOffsetY !== undefined
          ? { scale: photo.sourceScale, offsetX: photo.sourceOffsetX, offsetY: photo.sourceOffsetY }
          : coverFitSource(photo);
      result.push({
        id: photo.id,
        image: photo.image,
        coords: photo.coords,
        onCoordsChange: (c) => updatePhotoCoords(photo.id, c),
        accentClass: LAYER_COLORS[index % LAYER_COLORS.length],
        selected: selectedLayerId === photo.id,
        onSelect: () => setSelectedLayerId(photo.id),
        naturalAspect: photo.naturalAspect,
        source: storedSource,
        onSourceChange: (s) => updatePhotoSource(photo.id, s),
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
  }, [sideData.photos, textImage, sideData.textCoords, setSideData, updatePhotoCoords, updatePhotoSource, coverFitSource, selectedLayerId]);

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

    // Zone geometry (in canvas pixels) — still used for positioning photos
    // since coords are zone-relative, but no longer used to clip drawing.
    // Customers can now drag layers anywhere on the t-shirt (sleeves,
    // hem, etc.) and the mockup reflects exactly what they placed.
    const zoneW = zone ? 800 * zone.scale : 800;
    const zoneH = zone ? 800 * (zone.scaleY ?? zone.scale) : 800;
    const zoneX = zone ? 800 * zone.x - zoneW / 2 : 0;
    const zoneY = zone ? 800 * zone.y - zoneH / 2 : 0;

    // Draw photo layers (positioned via zone offset; clipping removed —
    // off-zone parts are visible on the mockup, matching the live preview).
    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        ctx.globalAlpha = 0.8;
        drawPhotoOntoCanvas(ctx, img, zoneX, zoneY, zoneW, zoneH, photo);
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
      // Text width is now canvas-bounded, not zone-bounded — must match
      // the drawing logic below or the telemetry value is misleading.
      const maxTextWidth = Math.min(800 * 0.95, txDiag * 2, (800 - txDiag) * 2);
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

    // Draw text (multiline, constrained by the full canvas now that the
    // zone is no longer a hard boundary — long text can flow beyond the
    // dashed editor zone onto the t-shirt's sleeves / hem).
    if (side.designText.trim()) {
      const tc = side.textCoords;
      const tx = zoneX + zoneW * tc.x;
      const ty = zoneY + zoneH * tc.y;
      // Center-aligned text: width must fit within the canvas given its
      // position; the side closer to the edge still bounds maxWidth so
      // text doesn't run off the mockup entirely.
      const fromLeft = tx * 2;
      const fromRight = (800 - tx) * 2;
      const maxTextWidth = Math.min(800 * 0.95, fromLeft, fromRight);
      const textRotation = tc.rotation ?? 0;
      let textMetrics: { overflow: boolean; fontSize: number; widest: number };
      if (textRotation) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate((textRotation * Math.PI) / 180);
        textMetrics = drawMultilineText(ctx, side.designText, 0, 0, maxTextWidth, side.selectedFont.family, side.textColor, 80);
        ctx.restore();
      } else {
        textMetrics = drawMultilineText(ctx, side.designText, tx, ty, maxTextWidth, side.selectedFont.family, side.textColor, 80);
      }
      if (textMetrics.overflow) {
        logCompositeEvent("textOverflow", {
          source: "compositeSide",
          side: view,
          textPreview: side.designText.slice(0, 60),
          maxTextWidth,
          fontSize: textMetrics.fontSize,
          widest: textMetrics.widest,
          fontFamily: side.selectedFont.family,
        });
      }
    }

    return canvas.toDataURL("image/png");
  }, [productConfig]);

  // Composite design-only (photos + text on transparent background, no product)
  // Used as the "print file" saved alongside the full mockup.
  //
  // Output is sized to the full mockup-canvas area (not the zone) so the
  // print file contains every layer the customer placed, including ones
  // that extend onto sleeves, hem, or beyond the dashed editor zone. The
  // print shop is free to crop to the actual garment area at their end.
  //
  // Resolution: 4000 px on the longer side. The mockup source is always
  // 800×800, so this is 5× linear scale ≈ 5x DPI on the source mockup.
  // For a 33×33 cm t-shirt print area that's ~300 DPI — enough for DTG /
  // sublimation print. The user's investigation suggested 5900×7080 for
  // a 50×60 cm rectangular front at 300 DPI, but our mockup canvas is
  // square and capping at 4000 keeps the data-URL size manageable while
  // still well above print-quality at common print sizes.
  const compositeDesignOnly = useCallback(async (side: SideData, view: "front" | "back"): Promise<string | null> => {
    if (side.photos.length === 0 && !side.designText.trim()) return null;
    if (side.designText.trim()) await ensureFontReady(side.selectedFont.family);

    const { config } = productConfig;
    const resolvedSub = config.subProduct || catalog.getDefaultSubProduct(config.product as ProductType);
    const imageResult = catalog.findImageForColor(config.product as ProductType, resolvedSub, config.color as ProductColor, view);
    const zone = imageResult?.entry.placementZone;

    const PRINT_MAX = 4000;
    const canvasW = PRINT_MAX;
    const canvasH = PRINT_MAX;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d")!;

    // Zone in print-canvas pixels — used to map zone-relative photo coords
    // to t-shirt-canvas positions, the same way compositeSide does.
    const printZoneW = zone ? canvasW * zone.scale : canvasW;
    const printZoneH = zone ? canvasH * (zone.scaleY ?? zone.scale) : canvasH;
    const printZoneX = zone ? canvasW * zone.x - printZoneW / 2 : 0;
    const printZoneY = zone ? canvasH * zone.y - printZoneH / 2 : 0;

    for (const photo of side.photos) {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = photo.image;
        });
        drawPhotoOntoCanvas(ctx, img, printZoneX, printZoneY, printZoneW, printZoneH, photo);
      } catch { /* skip */ }
    }

    // [composite-telemetry] same as compositeSide above.
    {
      const tcX = side.textCoords.x;
      const tcY = side.textCoords.y;
      const txDiag = printZoneX + printZoneW * tcX;
      const maxTextWidth = Math.min(canvasW * 0.95, txDiag * 2, (canvasW - txDiag) * 2);
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
        zoneX: printZoneX,
        zoneY: printZoneY,
        zoneW: printZoneW,
        zoneH: printZoneH,
        canvasW,
        canvasH,
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
      const tx = printZoneX + printZoneW * tc.x;
      const ty = printZoneY + printZoneH * tc.y;
      // Center-aligned text: width must fit within the full print canvas
      // given its position. The zone is no longer a hard boundary so the
      // limit is the canvas edge, not the dashed-rectangle edge.
      const maxTextWidth = Math.min(canvasW * 0.95, tx * 2, (canvasW - tx) * 2);
      // Scale the text font size proportionally — 10% of canvas width
      // gives ~400 px at PRINT_MAX=4000, the same relative size as the
      // 80 px on the 800 px mockup.
      const fontPx = Math.round(canvasW * 0.1);
      const textRotation = tc.rotation ?? 0;
      let textMetrics: { overflow: boolean; fontSize: number; widest: number };
      if (textRotation) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate((textRotation * Math.PI) / 180);
        textMetrics = drawMultilineText(ctx, side.designText, 0, 0, maxTextWidth, side.selectedFont.family, side.textColor, fontPx);
        ctx.restore();
      } else {
        textMetrics = drawMultilineText(ctx, side.designText, tx, ty, maxTextWidth, side.selectedFont.family, side.textColor, fontPx);
      }
      if (textMetrics.overflow) {
        logCompositeEvent("textOverflow", {
          source: "compositeDesignOnly",
          side: view,
          textPreview: side.designText.slice(0, 60),
          maxTextWidth,
          fontSize: textMetrics.fontSize,
          widest: textMetrics.widest,
          fontFamily: side.selectedFont.family,
        });
      }
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
        description="ატვირთე ფოტო და დაბეჭდე უნიკალური დიზაინი მაისურზე, oversize ჰუდიზე, ჩანთაზე ან ქეისზე. რეცხვაგამძლე ეკოლოგიური საღებავი, შეკვეთიდან იმავე ან მეორე დღეს."
      />
      <AppHeader />
      <ContactBar />
      <LoginModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message={loginModalMessage}
      />
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

          {/* AI design (Phase 1) — describe a design and generate it */}
          <SimpleAiPanel
            lang={lang}
            prompt={aiPrompt}
            onPromptChange={setAiPrompt}
            styleOptions={aiStyleOptions}
            selectedStyle={aiStyle}
            onSelectStyle={setAiStyle}
            withBackground={aiWithBackground}
            onToggleBackground={setAiWithBackground}
            generating={aiGenerating}
            status={aiStatus}
            resultImage={aiResult?.resultImage ?? null}
            transferLabel={aiTransferLabel}
            canGenerate={aiPrompt.trim().length > 0 && !aiGenerating}
            onGenerate={handleAiGenerate}
            onTransfer={handleAiTransfer}
            onRegenerate={handleAiGenerate}
            onStartNew={handleAiStartNew}
            onDownload={handleAiDownload}
          />

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
                      width={64}
                      height={64}
                      className="h-16 w-16 rounded-lg object-cover border border-border"
                      loading="lazy"
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

            {/* Handle-semantics hint. Was previously a floating tooltip
                in DraggablePlacement that overlapped the photo's top
                edge inside the print zone area (bug 2). Lifting it into
                the sidebar keeps the preview clean while still giving
                customers an inline reminder of what each handle does.
                Conditional on hasPhotos so the line only appears when
                it's relevant. */}
            {hasPhotos && (
              <p className="text-[10px] leading-snug text-muted-foreground">
                {lang === "en"
                  ? "Corners: resize • Edges: crop • Center: move (Alt: pan)"
                  : "კუთხეები: ზომა • კიდეები: ჭრა • ცენტრი: გადატანა (Alt: წანაცვლება)"}
              </p>
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
                        quantity,
                        designState: buildDesignStateInput(
                          frontData,
                          backData,
                          productConfig.config.product,
                          productConfig.config.subProduct,
                          productConfig.config.color,
                        ),
                      });
                      toast({ title: "კალათაში დაემატა ✓" });
                      setQuantity(1);
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
                      <div>
                        <h3 className="text-sm font-semibold mb-2">რაოდენობა</h3>
                        <QuantityStepper value={quantity} onChange={setQuantity} />
                      </div>
                      <Button
                        variant="outline"
                        className="w-full h-11 gap-2 font-semibold text-sm"
                        onClick={handleAddToCart}
                        disabled={addingToCart}
                      >
                        <ShoppingBag className="h-4 w-4" />
                        {addingToCart ? "ემატება..." : "კალათაში დამატება"}
                      </Button>
                      <Suspense fallback={null}>
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
                          quantity={quantity}
                        >
                          <span className="hidden" />
                        </OrderDialog>
                      </Suspense>
                    </>
                  );
                })()}
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
