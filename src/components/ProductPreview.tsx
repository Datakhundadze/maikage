import type { PlacementCoords } from "@/lib/catalog";
import { catalog, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import DraggablePlacement from "@/components/DraggablePlacement";

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
  // Look up the catalog entry for a real mockup image
  const subProduct = catalog.getDefaultSubProduct(productName as ProductType);
  const entry = catalog.findProduct(
    productName as ProductType,
    subProduct,
    colorName as ProductColor,
    view as ProductView,
  );
  const mockupUrl = entry?.imageUrl ?? null;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="relative w-full max-w-lg aspect-square rounded-2xl bg-card border border-border flex items-center justify-center overflow-hidden select-none">
        {mockupUrl ? (
          <img
            src={mockupUrl}
            alt={`${productName} ${colorName} ${view}`}
            className="absolute inset-0 w-full h-full object-contain p-4 pointer-events-none"
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
