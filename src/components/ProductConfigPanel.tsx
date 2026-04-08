import { useState } from "react";
import { PRODUCTS, SUB_PRODUCTS, COLORS, catalog, BRAND_SIZES, type ProductType, type ProductColor, type ProductView } from "@/lib/catalog";
import type { ProductConfig } from "@/hooks/useProductConfig";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";

interface ProductConfigPanelProps {
  config: ProductConfig;
  locked: boolean;
  onProductChange: (p: ProductType) => void;
  onSubProductChange: (s: string) => void;
  onColorChange: (c: ProductColor) => void;
  onViewChange: (v: ProductView) => void;
  selectedSize?: string;
  onSizeChange?: (size: string) => void;
  excludeProducts?: ProductType[];
}

export default function ProductConfigPanel({
  config,
  locked,
  onProductChange,
  onSubProductChange,
  onColorChange,
  onViewChange,
  selectedSize,
  onSizeChange,
  excludeProducts = [],
}: ProductConfigPanelProps) {
  const { lang } = useAppState();
  const [productOpen, setProductOpen] = useState(true);
  const [brandOpen, setBrandOpen] = useState(false);

  const subProducts = SUB_PRODUCTS[config.product];
  const availableColors = catalog.getAvailableColors(config.product, config.subProduct);
  const availableSizes = BRAND_SIZES[config.subProduct] || [];

  return (
    <div className={`space-y-4 ${locked ? "opacity-60 pointer-events-none" : ""}`}>

      {/* Product — collapsible */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <button
          onClick={() => setProductOpen((o) => !o)}
          className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-card-foreground hover:bg-muted/30 transition-colors"
        >
          <span>{t(lang, "config.product")}</span>
          <div className="flex items-center gap-2">
            {!productOpen && (
              <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                {t(lang, `products.${config.product}`)}
              </span>
            )}
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${productOpen ? "rotate-180" : ""}`} />
          </div>
        </button>
        {productOpen && (
          <div className="px-3 pb-3">
            <div className="grid grid-cols-3 gap-2">
              {PRODUCTS.filter(p => !excludeProducts.includes(p.type)).map((p) => (
                <button
                  key={p.type}
                  onClick={() => { onProductChange(p.type); setBrandOpen(true); }}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2.5 text-center transition-all text-xs ${
                    config.product === p.type
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-background hover:border-primary/50"
                  }`}
                >
                  <span className="text-lg">{p.icon}</span>
                  <span className="font-medium text-card-foreground leading-tight">
                    {t(lang, `products.${p.type}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Brand — collapsible */}
      {subProducts.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <button
            onClick={() => setBrandOpen((o) => !o)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-card-foreground hover:bg-muted/30 transition-colors"
          >
            <span>{t(lang, "config.brand")}</span>
            <div className="flex items-center gap-2">
              {!brandOpen && config.subProduct && (
                <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {config.subProduct}
                </span>
              )}
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${brandOpen ? "rotate-180" : ""}`} />
            </div>
          </button>
          {brandOpen && (
            <div className="px-3 pb-3">
              <div className="flex flex-wrap gap-2">
                {subProducts.map((sub) => (
                  <Button
                    key={sub}
                    size="sm"
                    variant={config.subProduct === sub ? "default" : "outline"}
                    onClick={() => { onSubProductChange(sub); setBrandOpen(false); }}
                  >
                    {sub}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color — always flat */}
      {availableColors.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-card-foreground mb-2">{t(lang, "config.color")}</h3>
          <div className="grid grid-cols-5 gap-2">
            {COLORS.filter((c) => availableColors.includes(c.name)).map((c) => {
              const selected = config.color === c.name;
              return (
                <button
                  key={c.name}
                  onClick={() => onColorChange(c.name)}
                  className="group flex flex-col items-center gap-1"
                  title={c.name}
                >
                  <div
                    className={`h-8 w-8 rounded-full border-2 transition-all ${
                      selected
                        ? "border-primary scale-110 ring-2 ring-primary/30"
                        : "border-border group-hover:border-primary/50"
                    } ${c.name === "White" || c.name === "Cream" ? "border-muted-foreground/30" : ""}`}
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-[10px] text-muted-foreground leading-tight">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Size — always flat */}
      {availableSizes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-card-foreground mb-2">{t(lang, "config.size")}</h3>
          <select
            value={selectedSize || ""}
            onChange={(e) => onSizeChange?.(e.target.value)}
            className="w-full rounded-lg border border-border bg-card text-foreground text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary cursor-pointer"
          >
            <option value="" disabled>{t(lang, "config.chooseSize")}</option>
            {availableSizes.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </div>
      )}

      {/* View — always flat, hide for Mug */}
      {config.product !== "Mug" && (
        <div>
          <h3 className="text-sm font-semibold text-card-foreground mb-2">{t(lang, "config.view")}</h3>
          <div className="flex gap-2">
            {(["front", "back"] as ProductView[]).map((v) => (
              <button
                key={v}
                onClick={() => onViewChange(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  config.view === v
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground border border-border hover:text-foreground hover:bg-muted/70"
                }`}
              >
                {v === "front" ? t(lang, "config.front") : t(lang, "config.back")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
