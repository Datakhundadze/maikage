import type { PlacementCoords } from "@/lib/catalog";
import { catalog, COLOR_FILTERS, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import DraggablePlacement from "@/components/DraggablePlacement";
import { useMemo } from "react";

interface ProductPreviewProps {
  productName: string;
  colorName: string;
  view: string;
  placementCoords: PlacementCoords;
  onCoordsChange?: (coords: PlacementCoords) => void;
  designImage?: string | null;
  disabled?: boolean;
}

const PRODUCT_EMOJI: Record<string, string> = {
  "Hoodie": "🧥",
  "T-Shirt": "👕",
  "Tote Bag": "👜",
  "Cap": "🧢",
  "Apron": "👨‍🍳",
  "Phone Case": "📱",
};

export default function ProductPreview({
  productName, colorName, view, placementCoords, onCoordsChange, designImage, disabled,
}: ProductPreviewProps) {
  const subProduct = catalog.getDefaultSubProduct(productName as ProductType);

  // Always try to resolve the White base image for color filtering
  const whiteEntry = catalog.findProduct(
    productName as ProductType,
    subProduct,
    "White" as ProductColor,
    view as ProductView,
  );
  const baseImageUrl = whiteEntry?.imageUrl ?? null;

  // Compute CSS filter string based on selected color
  const colorFilter = useMemo(() => {
    const color = colorName as ProductColor;
    const filter = COLOR_FILTERS[color];
    if (!filter) return "none"; // White or unknown — no filter
    return `hue-rotate(${filter.hueRotate}deg) saturate(${filter.saturate}%) brightness(${filter.brightness}%)`;
  }, [colorName]);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="relative w-full max-w-lg aspect-square rounded-2xl bg-card border border-border flex items-center justify-center overflow-hidden select-none">
        {baseImageUrl ? (
          <img
            src={baseImageUrl}
            alt={`${productName} ${colorName} ${view}`}
            className="absolute inset-0 w-full h-full object-contain p-4 pointer-events-none transition-[filter] duration-300"
            style={{ filter: colorFilter }}
          />
        ) : (
          <div className="text-center pointer-events-none">
            <div className="text-6xl mb-4">{PRODUCT_EMOJI[productName] ?? "👕"}</div>
            <p className="text-sm text-muted-foreground">
              {productName} · {colorName} · {view}
            </p>
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
