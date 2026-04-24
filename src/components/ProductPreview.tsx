import { useRef, useEffect, useState } from "react";
import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import DraggablePlacement from "@/components/DraggablePlacement";

export interface DesignLayer {
  id: string;
  image: string;
  coords: PlacementCoords;
  onCoordsChange: (coords: PlacementCoords) => void;
  accentClass?: string;
  selected?: boolean;
  onSelect?: () => void;
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
  productName, subProduct, colorName, view, placementCoords, onCoordsChange, designImage, disabled, layers, onBackgroundClick,
}: ProductPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

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

  useEffect(() => {
    setImgLoaded(false);
    if (!baseImageUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setImgLoaded(true); };
    img.onerror = () => setImgLoaded(false);
    img.src = baseImageUrl;
  }, [baseImageUrl]);

  const effectiveColorHex = colorName === "Black" ? "#1a1a1a" : colorHex;
  useEffect(() => {
    if (!imgLoaded || !imgRef.current || !canvasRef.current) return;
    if (isExactImage) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = imgRef.current.naturalWidth;
      canvas.height = imgRef.current.naturalHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imgRef.current, 0, 0);
    } else {
      colorizeImage(imgRef.current, canvasRef.current, effectiveColorHex);
    }
  }, [imgLoaded, effectiveColorHex, isExactImage]);

  const isDarkColor = ["Black", "Dark Navy", "Brown", "Burgundy"].includes(colorName);
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

        {/* Placement zone outline: shows the printable area */}
        {zone && (hasLayers || designImage) && (
          <div
            className="absolute border-2 border-dashed border-muted-foreground/30 rounded-md pointer-events-none"
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
          >
            <img src={layer.image} alt="Design" className="w-full h-full object-contain opacity-80" />
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
              <img src={designImage} alt="Design" className="w-full h-full object-contain opacity-80" />
            )}
          </DraggablePlacement>
        )}
      </div>
    </div>
  );
}
