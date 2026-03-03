import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLORS, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import DraggablePlacement from "@/components/DraggablePlacement";


interface ProductPreviewProps {
  productName: string;
  subProduct?: string;
  colorName: string;
  view: string;
  placementCoords: PlacementCoords;
  onCoordsChange?: (coords: PlacementCoords) => void;
  designImage?: string | null;
  disabled?: boolean;
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

export default function ProductPreview({
  productName, subProduct, colorName, view, placementCoords, onCoordsChange, designImage, disabled,
}: ProductPreviewProps) {
  const resolvedSub = subProduct || catalog.getDefaultSubProduct(productName as ProductType);

  // Always try to resolve the White base image for color filtering
  const whiteEntry = catalog.findProduct(
    productName as ProductType,
    resolvedSub,
    "White" as ProductColor,
    view as ProductView,
  );
  const baseImageUrl = whiteEntry?.imageUrl ?? null;

  console.log("[ProductPreview]", { colorName, colorHex: COLORS.find(c => c.name === colorName)?.hex, baseImageUrl });

  // Use light background for dark colors so the product remains visible
  const isDarkColor = ["Black", "Dark Navy", "Brown", "Burgundy"].includes(colorName);
  const bgStyle = isDarkColor ? { backgroundColor: "#e0e0e0" } : undefined;
  const bgClass = isDarkColor ? "" : "bg-card";

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        className={`relative w-full max-w-lg aspect-square rounded-2xl ${bgClass} border border-border flex items-center justify-center overflow-hidden select-none transition-colors duration-300`}
        style={bgStyle}
      >
        {baseImageUrl ? (
          <>
            <img
              src={baseImageUrl}
              alt={`${productName} ${colorName} ${view}`}
              className="absolute inset-0 w-full h-full object-contain p-4 pointer-events-none"
            />
            {/* Color overlay using multiply blend mode to tint the white mockup */}
            <div
              className="absolute inset-0 pointer-events-none transition-colors duration-300"
              style={{
                backgroundColor: COLORS.find(c => c.name === colorName)?.hex ?? "transparent",
                mixBlendMode: "multiply",
              }}
            />
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {PRODUCT_OUTLINES[productName] ?? PRODUCT_OUTLINES["T-Shirt"]}
          </div>
        )}

        {/* Interactive placement zone */}
        <DraggablePlacement
          coords={placementCoords}
          onCoordsChange={onCoordsChange ?? (() => {})}
          disabled={disabled}
        >
          {designImage && (
            <img src={designImage} alt="Design" className="w-full h-full object-contain opacity-80" />
          )}
        </DraggablePlacement>
      </div>
    </div>
  );
}
