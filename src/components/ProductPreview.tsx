import type { PlacementCoords } from "@/lib/catalog";
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

export default function ProductPreview({
  productName, colorName, view, placementCoords, onCoordsChange, designImage, disabled,
}: ProductPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="relative w-full max-w-lg aspect-square rounded-2xl bg-card border border-border flex items-center justify-center overflow-hidden select-none">
        {/* Placeholder product display */}
        <div className="text-center pointer-events-none">
          <div className="text-6xl mb-4">
            {productName === "Hoodie" ? "🧥" :
             productName === "T-Shirt" ? "👕" :
             productName === "Long Sleeve" ? "🧤" :
             productName === "Polo Shirt" ? "👔" :
             productName === "Tote Bag" ? "👜" :
             productName === "Cap" ? "🧢" :
             productName === "Raincoat" ? "🌧️" :
             productName === "Apron" ? "👨‍🍳" : "🦺"}
          </div>
          <p className="text-sm text-muted-foreground">
            {productName} · {colorName} · {view}
          </p>
        </div>

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
