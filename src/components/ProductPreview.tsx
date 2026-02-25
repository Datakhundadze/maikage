import type { PlacementCoords } from "@/lib/catalog";

interface ProductPreviewProps {
  productName: string;
  colorName: string;
  view: string;
  placementCoords: PlacementCoords;
}

export default function ProductPreview({ productName, colorName, view, placementCoords }: ProductPreviewProps) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="relative w-full max-w-lg aspect-square rounded-2xl bg-card border border-border flex items-center justify-center overflow-hidden">
        {/* Placeholder product display */}
        <div className="text-center">
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

        {/* Placement zone overlay */}
        <div
          className="absolute border-2 border-dashed border-banana-500/60 rounded-md pointer-events-none"
          style={{
            left: `${(placementCoords.x - placementCoords.scale / 2) * 100}%`,
            top: `${(placementCoords.y - placementCoords.scale / 2) * 100}%`,
            width: `${placementCoords.scale * 100}%`,
            height: `${placementCoords.scale * 100}%`,
          }}
        >
          <div className="absolute -top-5 left-0 text-[10px] text-banana-500 font-mono">
            {Math.round(placementCoords.x * 100)}%, {Math.round(placementCoords.y * 100)}%
          </div>
        </div>
      </div>
    </div>
  );
}
