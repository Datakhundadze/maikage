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

const DEFAULT_CONFIG: ProductConfig = {
  product: "T-Shirt",
  subProduct: catalog.getDefaultSubProduct("T-Shirt"),
  color: "White",
  view: "front",
  placementCoords: { x: 0.5, y: 0.42, scale: 0.38 },
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
    const entry = catalog.findProduct(product, subProduct, color, view);
    return {
      product,
      subProduct,
      color,
      view,
      placementCoords: entry?.placementZone || DEFAULT_CONFIG.placementCoords,
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
    const entry = catalog.findProduct(product, subProduct, color, config.view);
    setConfig({
      product,
      subProduct,
      color,
      view: config.view,
      placementCoords: entry?.placementZone || { x: 0.5, y: 0.28, scale: 0.38 },
      size: "",
    });
  }, [config.color, config.view]);

  const setSubProduct = useCallback((subProduct: string) => {
    const colors = catalog.getAvailableColors(config.product, subProduct);
    const color = colors.includes(config.color) ? config.color : colors[0] || "Black";
    const entry = catalog.findProduct(config.product, subProduct, color, config.view);
    setConfig((prev) => ({
      ...prev,
      subProduct,
      color,
      placementCoords: entry?.placementZone || prev.placementCoords,
      size: "",
    }));
  }, [config.product, config.color, config.view]);

  const setColor = useCallback((color: ProductColor) => {
    const entry = catalog.findProduct(config.product, config.subProduct, color, config.view);
    setConfig((prev) => ({
      ...prev,
      color,
      placementCoords: entry?.placementZone || prev.placementCoords,
    }));
  }, [config.product, config.subProduct, config.view]);

  const setView = useCallback((view: ProductView) => {
    const entry = catalog.findProduct(config.product, config.subProduct, config.color, view);
    setConfig((prev) => ({
      ...prev,
      view,
      placementCoords: entry?.placementZone || prev.placementCoords,
    }));
  }, [config.product, config.subProduct, config.color]);

  const setPlacementCoords = useCallback((coords: PlacementCoords) => {
    setConfig((prev) => ({ ...prev, placementCoords: coords }));
  }, []);

  const setSize = useCallback((size: string) => {
    setConfig((prev) => ({ ...prev, size }));
  }, []);

  return { config, locked, setLocked, setProduct, setSubProduct, setColor, setView, setPlacementCoords, setSize };
}
