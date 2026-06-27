import { useRef, useEffect } from "react";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import DraggablePlacement, { type SourceState } from "@/components/DraggablePlacement";

export interface DesignLayer {
  id: string;
  image: string;
  coords: PlacementCoords;
  onCoordsChange: (coords: PlacementCoords) => void;
  accentClass?: string;
  selected?: boolean;
  onSelect?: () => void;
  /** Source image's natural width / height. Forwarded to
   *  DraggablePlacement as `aspectLock` so corner drag stays
   *  proportional and doesn't stretch the image. */
  naturalAspect?: number;
  /** Source crop / pan state. When present together with
   *  `naturalAspect`, the layer image is rendered with explicit
   *  positioning (cropped through the window) rather than
   *  object-cover, and edge handles become crop handles. */
  source?: SourceState;
  onSourceChange?: (s: SourceState) => void;
}

interface ProductPreviewProps {
  productName: string;
  subProduct?: string;
  colorName: string;
  view: string;
  placementCoords: PlacementCoords;
  onCoordsChange?: (coords: PlacementCoords) => void;
  designImage?: string | null;
  disabled?: boolean;
  /** Multiple independent design layers (overrides single designImage if provided) */
  layers?: DesignLayer[];
  /** Called when user clicks the background (outside any layer) */
  onBackgroundClick?: () => void;
  /** Override the alt text on the design image (for accessibility / SEO). */
  designAlt?: string;
}

// SVG placeholder outlines for products without mockup images
const PRODUCT_OUTLINES: Record<string, JSX.Element> = {
  "T-Shirt": (
    <svg viewBox="0 0 200 240" fill="none" stroke="currentColor" strokeWidth="2" className="w-3/4 h-3/4 text-muted-foreground/40">
      <path d="M60 30 L30 60 L50 80 L50 210 L150 210 L150 80 L170 60 L140 30 L120 45 Q100 55 80 45 Z" />
    </svg>
  ),
  "Hoodie": (
    <svg viewBox="0 0 200 240" fill="none" stroke="currentColor" strokeWidth="2" className="w-3/4 h-3/4 text-muted-foreground/40">
      <path d="M60 35 L25 70 L45 90 L45 215 L155 215 L155 90 L175 70 L140 35 L125 50 Q100 65 75 50 Z" />
      <path d="M75 35 Q100 15 125 35" />
      <ellipse cx="100" cy="35" rx="15" ry="10" />
    </svg>
  ),
  "Tote Bag": (
    <svg viewBox="0 0 200 240" fill="none" stroke="currentColor" strokeWidth="2" className="w-3/4 h-3/4 text-muted-foreground/40">
      <rect x="40" y="70" width="120" height="150" rx="4" />
      <path d="M70 70 Q70 30 100 30 Q130 30 130 70" />
    </svg>
  ),
  "Cap": (
    <svg viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth="2" className="w-3/4 h-3/4 text-muted-foreground/40">
      <path d="M30 120 Q30 60 100 50 Q170 60 170 120" />
      <path d="M30 120 L20 130 L180 130 L170 120" />
      <ellipse cx="100" cy="120" rx="70" ry="15" />
    </svg>
  ),
  "Apron": (
    <svg viewBox="0 0 200 260" fill="none" stroke="currentColor" strokeWidth="2" className="w-3/4 h-3/4 text-muted-foreground/40">
      <path d="M70 30 L60 50 L50 50 L50 240 L150 240 L150 50 L140 50 L130 30 Q100 20 70 30 Z" />
      <rect x="75" y="130" width="50" height="40" rx="3" />
      <path d="M50 70 L20 60" />
      <path d="M150 70 L180 60" />
    </svg>
  ),
  "Phone Case": (
    <svg viewBox="0 0 140 240" fill="none" stroke="currentColor" strokeWidth="2" className="w-1/2 h-3/4 text-muted-foreground/40">
      <rect x="20" y="20" width="100" height="200" rx="16" />
      <rect x="30" y="35" width="80" height="150" rx="4" />
      <circle cx="70" cy="205" r="6" />
    </svg>
  ),
};

/**
 * Render a layer's image, picking between two modes:
 *
 * 1. *Crop mode* — when the layer has both `naturalAspect` and an explicit
 *    `source` state, the img is absolutely positioned inside the window
 *    with its size and offset computed from `source.scale/offsetX/offsetY`
 *    (all in zone fractions). The DraggablePlacement parent has
 *    `overflow:hidden` so anything outside the window is clipped — that's
 *    the crop.
 *
 * 2. *Cover mode* — fallback for text layers and photos whose natural
 *    aspect hasn't been measured yet. Uses `object-cover` exactly as
 *    before, preserving the existing visual behavior for old data.
 */
function renderLayerImage(layer: DesignLayer, zone: PlacementCoords | undefined): JSX.Element {
  const naturalAspect = layer.naturalAspect;
  const source = layer.source;
  if (naturalAspect && source && naturalAspect > 0 && source.scale > 0) {
    const zoneW = zone?.scale ?? 1;
    const zoneH = zone?.scaleY ?? zone?.scale ?? 1;
    const winScale = layer.coords.scale;
    const winScaleY = layer.coords.scaleY ?? layer.coords.scale;
    // Source dims as a fraction of the window box.
    const srcWInWin = (source.scale) / winScale;
    // Source height in zone-Y-fraction: source pixel-width / naturalAspect, then convert
    // to zone-Y-fraction by dividing by zoneH (since source width = source.scale × zoneW
    // pixel-equivalents, height = (source.scale × zoneW) / naturalAspect, fraction = /zoneH).
    const srcHFrac = (source.scale * zoneW) / (naturalAspect * zoneH);
    const srcHInWin = srcHFrac / winScaleY;
    // Offsets expressed as window fractions for CSS calc().
    const offXInWin = source.offsetX / winScale;
    const offYInWin = source.offsetY / winScaleY;
    return (
      <img
        src={layer.image}
        alt="Design"
        className="absolute max-w-none"
        style={{
          width: `${srcWInWin * 100}%`,
          height: `${srcHInWin * 100}%`,
          left: `calc(50% + ${offXInWin * 100}%)`,
          top: `calc(50% + ${offYInWin * 100}%)`,
          transform: "translate(-50%, -50%)",
        }}
        loading="eager"
        fetchPriority="high"
      />
    );
  }
  // Text layers carry a naturalAspect but NO crop `source` → render CONTAIN so
  // the whole word always shows (never centre-cropped) and scales as one unit
  // with its aspect-locked window. Photos keep object-cover (cover-fit).
  const isText = naturalAspect !== undefined && naturalAspect > 0 && !source;
  return (
    <img
      src={layer.image}
      alt="Design"
      width={800}
      height={800}
      className={`w-full h-full ${isText ? "object-contain" : "object-cover"}`}
      loading="eager"
      fetchPriority="high"
    />
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function colorizeImage(img: HTMLImageElement, canvas: HTMLCanvasElement, targetHex: string) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const target = hexToRgb(targetHex);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const t = lum / 255;
    data[i] = Math.round(target.r * t);
    data[i + 1] = Math.round(target.g * t);
    data[i + 2] = Math.round(target.b * t);
  }
  ctx.putImageData(imageData, 0, 0);
}

export default function ProductPreview({
  productName, subProduct, colorName, view, placementCoords, onCoordsChange, designImage, disabled, layers, onBackgroundClick, designAlt,
}: ProductPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const resolvedSub = subProduct || catalog.getDefaultSubProduct(productName as ProductType);
  const imageResult = catalog.findImageForColor(productName as ProductType, resolvedSub, colorName as ProductColor, view as ProductView);
  const baseImageUrl = imageResult?.entry.imageUrl ?? null;
  const isExactImage = imageResult?.isExact ?? false;
  const zone = imageResult?.entry.placementZone;
  const colorHex = COLORS.find(c => c.name === colorName)?.hex ?? "#FFFFFF";

  // Zone outline (so user sees the print area)
  const zoneW = zone?.scale ?? 1;
  const zoneH = zone?.scaleY ?? zone?.scale ?? 1;
  const zoneCx = zone?.x ?? 0.5;
  const zoneCy = zone?.y ?? 0.5;
  const zoneStyle = {
    left: `${(zoneCx - zoneW / 2) * 100}%`,
    top: `${(zoneCy - zoneH / 2) * 100}%`,
    width: `${zoneW * 100}%`,
    height: `${zoneH * 100}%`,
  };

  const effectiveColorHex = colorName === "Black" ? "#1a1a1a" : colorHex;

  // Single effect: load image and draw to canvas atomically. The previous split
  // (load in one effect, draw in a second keyed on imgLoaded) lost view-toggle
  // redraws when the new image came from cache — both setImgLoaded(false) and
  // setImgLoaded(true) batched within the same tick, so the draw effect didn't
  // see a dep change and the canvas kept showing the previous image.
  useEffect(() => {
    if (!baseImageUrl || !canvasRef.current) return;
    let cancelled = false;
    const canvas = canvasRef.current;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      if (isExactImage) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      } else {
        colorizeImage(img, canvas, effectiveColorHex);
      }
    };
    img.src = baseImageUrl;
    return () => { cancelled = true; };
  }, [baseImageUrl, isExactImage, effectiveColorHex]);

  const isDarkColor = ["Black", "Dark Navy", "Brown", "Burgundy", "Sol's Khaki", "Sol's Emerald", "Sol's Electric", "Sol's Navy", "Sol's Ultramarine"].includes(colorName);
  const bgStyle = isDarkColor ? { backgroundColor: "#d0d0d0" } : undefined;
  const bgClass = isDarkColor ? "" : "bg-card";

  // Determine which layers to render
  const hasLayers = layers && layers.length > 0;

  return (
    <div className="flex h-full items-center justify-center p-8" onPointerDown={(e) => { if (e.target === e.currentTarget && onBackgroundClick) onBackgroundClick(); }}>
      <div
        className={`relative w-full max-w-lg aspect-square rounded-2xl ${bgClass} border border-border flex items-center justify-center overflow-hidden select-none transition-colors duration-300`}
        style={bgStyle}
        onPointerDown={(e) => {
          // Only fire if clicking directly on the container (background), not on a layer
          if (e.target === e.currentTarget && onBackgroundClick) {
            onBackgroundClick();
          }
        }}
      >
        {baseImageUrl ? (
          <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-contain p-4 pointer-events-none" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {PRODUCT_OUTLINES[productName] ?? PRODUCT_OUTLINES["T-Shirt"]}
          </div>
        )}

        {/* Placement zone outline: now a soft hint marking the initial
            drop location for uploaded photos. The zone no longer
            constrains where designs can go — customers are free to drag
            and resize anywhere on the mockup, including onto sleeves
            and edges. Subtler styling (thinner line, lower opacity) so
            it reads as guidance rather than a boundary. */}
        {zone && (hasLayers || designImage) && (
          <div
            className="absolute border border-dashed border-muted-foreground/20 rounded-md pointer-events-none"
            style={zoneStyle}
          />
        )}

        {/* Multi-layer mode */}
        {hasLayers && layers!.map((layer) => (
          <DraggablePlacement
            key={layer.id}
            coords={layer.coords}
            onCoordsChange={layer.onCoordsChange}
            disabled={disabled}
            accentClass={layer.accentClass}
            hideReadout
            selected={layer.selected}
            onSelect={layer.onSelect}
            zone={zone}
            aspectLock={layer.naturalAspect}
            source={layer.source}
            onSourceChange={layer.onSourceChange}
          >
            {renderLayerImage(layer, zone)}
          </DraggablePlacement>
        ))}

        {/* Single-layer fallback */}
        {!hasLayers && (
          <DraggablePlacement
            coords={placementCoords}
            onCoordsChange={onCoordsChange ?? (() => {})}
            disabled={disabled}
            accentClass={["White", "Cream", "Light Cream", "Beige", "Light Gray", "Light Gray Melange"].includes(colorName) ? "bg-gray-500" : undefined}
            borderClass={["White", "Cream", "Light Cream", "Beige", "Light Gray", "Light Gray Melange"].includes(colorName) ? "border-gray-400/70" : undefined}
            zone={zone}
          >
            {designImage && (
              <img
                src={designImage}
                alt={designAlt ?? "Design"}
                width={800}
                height={800}
                className="w-full h-full object-cover"
                loading="eager"
                fetchPriority="high"
              />
            )}
          </DraggablePlacement>
        )}
      </div>
    </div>
  );
}
