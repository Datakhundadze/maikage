import { useState, useCallback, useEffect } from "react";
import type { ProductType, ProductColor, ProductView, PlacementCoords } from "@/lib/catalog";
import { catalog } from "@/lib/catalog";

export interface ProductConfig {
  product: ProductType;
  subProduct: string;
  color: ProductColor;
  view: ProductView;
  placementCoords: PlacementCoords;
  size: string;
}

const STORAGE_KEY = "maika-product-config";

// placementCoords are interpreted ZONE-relative by DraggablePlacement and the
// composite canvas (see SimplePage compositeSide): scale=1 fills the printable
// zone; x=0.5, y=0.5 centres in it. Default to "fill the zone, centred" so the
// frame matches the dashed print area instead of being a tiny 14% sub-box.
const FILL_ZONE_COORDS: PlacementCoords = { x: 0.5, y: 0.5, scale: 1 };

const DEFAULT_CONFIG: ProductConfig = {
  product: "T-Shirt",
  subProduct: catalog.getDefaultSubProduct("T-Shirt"),
  color: "White",
  view: "front",
  placementCoords: FILL_ZONE_COORDS,
  size: "",
};

function loadStoredConfig(): ProductConfig {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ProductConfig>;
    // Always use the catalog's placement zone for the stored product —
    // never restore a stale placementCoords value, otherwise a previous
    // user drag stays even when the design changes.
    const product = (parsed.product || DEFAULT_CONFIG.product) as ProductType;
    const subProduct = parsed.subProduct || catalog.getDefaultSubProduct(product);
    const view = (parsed.view || DEFAULT_CONFIG.view) as ProductView;
    const color = (parsed.color || DEFAULT_CONFIG.color) as ProductColor;
    return {
      product,
      subProduct,
      color,
      view,
      placementCoords: FILL_ZONE_COORDS,
      size: parsed.size || "",
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function useProductConfig() {
  const [config, setConfig] = useState<ProductConfig>(loadStoredConfig);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {}
  }, [config]);

  const [locked, setLocked] = useState(false);

  const setProduct = useCallback((product: ProductType) => {
    const subProduct = catalog.getDefaultSubProduct(product);
    const colors = catalog.getAvailableColors(product, subProduct);
    const color = colors.includes(config.color) ? config.color : colors[0] || "Black";
    setConfig({
      product,
      subProduct,
      color,
      view: config.view,
      placementCoords: FILL_ZONE_COORDS,
      size: "",
    });
  }, [config.color, config.view]);

  const setSubProduct = useCallback((subProduct: string) => {
    const colors = catalog.getAvailableColors(config.product, subProduct);
    const color = colors.includes(config.color) ? config.color : colors[0] || "Black";
    setConfig((prev) => ({
      ...prev,
      subProduct,
      color,
      size: "",
    }));
  }, [config.product, config.color]);

  const setColor = useCallback((color: ProductColor) => {
    setConfig((prev) => ({ ...prev, color }));
  }, []);

  const setView = useCallback((view: ProductView) => {
    setConfig((prev) => ({ ...prev, view }));
  }, []);

  const setPlacementCoords = useCallback((coords: PlacementCoords) => {
    setConfig((prev) => ({ ...prev, placementCoords: coords }));
  }, []);

  const setSize = useCallback((size: string) => {
    setConfig((prev) => ({ ...prev, size }));
  }, []);

  return { config, locked, setLocked, setProduct, setSubProduct, setColor, setView, setPlacementCoords, setSize };
}
