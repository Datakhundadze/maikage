import { PRODUCTS, SUB_PRODUCTS, COLORS, catalog, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import type { ProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";

interface ProductConfigPanelProps {
  config: ProductConfig;
  locked: boolean;
  onProductChange: (p: ProductType) => void;
  onSubProductChange: (s: string) => void;
  onColorChange: (c: ProductColor) => void;
  onViewChange: (v: ProductView) => void;
}

export default function ProductConfigPanel({
  config,
  locked,
  onProductChange,
  onSubProductChange,
  onColorChange,
  onViewChange,
}: ProductConfigPanelProps) {
  const subProducts = SUB_PRODUCTS[config.product];
  const availableColors = catalog.getAvailableColors(config.product, config.subProduct);

  return (
    <div className={`space-y-4 ${locked ? "opacity-60 pointer-events-none" : ""}`}>
      {/* Product Type Grid */}
      <div>
        <h3 className="text-sm font-semibold text-card-foreground mb-2">Product</h3>
        <div className="grid grid-cols-3 gap-2">
          {PRODUCTS.map((p) => (
            <button
              key={p.type}
              onClick={() => onProductChange(p.type)}
              className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all text-xs
                ${
                  config.product === p.type
                    ? "border-banana-500 bg-banana-500/10 shadow-sm"
                    : "border-border bg-card hover:border-banana-500/50"
                }`}
            >
              <span className="text-lg">{p.icon}</span>
              <span className="font-medium text-card-foreground leading-tight">{p.type}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sub-Product Pills */}
      {subProducts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-card-foreground mb-2">Variant</h3>
          <div className="flex flex-wrap gap-2">
            {subProducts.map((sub) => (
              <Button
                key={sub}
                size="sm"
                variant={config.subProduct === sub ? "default" : "outline"}
                className={config.subProduct === sub ? "bg-banana-500 text-primary-foreground hover:bg-banana-600" : ""}
                onClick={() => onSubProductChange(sub)}
              >
                {sub}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Color Grid */}
      <div>
        <h3 className="text-sm font-semibold text-card-foreground mb-2">Color</h3>
        <div className="grid grid-cols-5 gap-2">
          {COLORS.map((c) => {
            const available = availableColors.includes(c.name);
            const selected = config.color === c.name;
            return (
              <button
                key={c.name}
                disabled={!available}
                onClick={() => onColorChange(c.name)}
                className={`group flex flex-col items-center gap-1 ${!available ? "opacity-30" : ""}`}
                title={c.name}
              >
                <div
                  className={`h-8 w-8 rounded-full border-2 transition-all ${
                    selected
                      ? "border-banana-500 scale-110 ring-2 ring-banana-500/30"
                      : "border-border group-hover:border-banana-500/50"
                  } ${c.name === "White" ? "border-muted-foreground/30" : ""}`}
                  style={{ backgroundColor: c.hex }}
                />
                <span className="text-[10px] text-muted-foreground leading-tight">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* View Toggle */}
      <div>
        <h3 className="text-sm font-semibold text-card-foreground mb-2">View</h3>
        <div className="flex gap-2">
          {(["front", "back"] as ProductView[]).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={config.view === v ? "default" : "outline"}
              className={config.view === v ? "bg-banana-500 text-primary-foreground hover:bg-banana-600" : ""}
              onClick={() => onViewChange(v)}
            >
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
