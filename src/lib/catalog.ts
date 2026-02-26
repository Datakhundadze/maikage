// Product catalog types and data

export type ProductType = 
  | "Hoodie" | "T-Shirt" | "Tote Bag" | "Cap" | "Apron" | "Phone Case";

export type ProductSubType = string;

export type ProductColor =
  | "Charcoal" | "Navy" | "Olive" | "Cream"
  | "Red" | "Royal Blue" | "Yellow" | "Orange"
  | "Hot Pink" | "Maroon" | "Purple" | "Lavender"
  | "Grey" | "Kelly Green" | "Indigo" | "Cyan"
  | "Midnight Blue" | "Heather Grey" | "White" | "Black";

export type ProductView = "front" | "back";

export interface PlacementCoords {
  x: number;
  y: number;
  scale: number;
}

export interface CatalogEntry {
  type: ProductType;
  subType: string;
  color: ProductColor;
  view: ProductView;
  filename: string;
  placementZone: PlacementCoords;
  imageUrl: string | null; // null = placeholder
}

export interface ProductInfo {
  type: ProductType;
  icon: string;
  description: string;
}

// Product metadata
export const PRODUCTS: ProductInfo[] = [
  { type: "Hoodie", icon: "🧥", description: "Classic pullover" },
  { type: "T-Shirt", icon: "👕", description: "Everyday essential" },
  { type: "Tote Bag", icon: "👜", description: "Carry your style" },
  { type: "Cap", icon: "🧢", description: "Top it off" },
  { type: "Apron", icon: "👨‍🍳", description: "Creative canvas" },
  { type: "Phone Case", icon: "📱", description: "Protect in style" },
];

// Sub-product definitions
export const SUB_PRODUCTS: Record<ProductType, string[]> = {
  "Hoodie": ["Washed Hoodie", "Washed Zipped Hoodie"],
  "T-Shirt": ["Washed T-Shirt", "Oversized T-Shirt", "Women's T-Shirt"],
  "Tote Bag": [],
  "Cap": [],
  "Apron": [],
  "Phone Case": [],
};

// All 20 colors with their display hex values
export const COLORS: { name: ProductColor; hex: string }[] = [
  { name: "Charcoal", hex: "#36454F" },
  { name: "Navy", hex: "#000080" },
  { name: "Olive", hex: "#808000" },
  { name: "Cream", hex: "#FFFDD0" },
  { name: "Red", hex: "#FF0000" },
  { name: "Royal Blue", hex: "#4169E1" },
  { name: "Yellow", hex: "#FFD700" },
  { name: "Orange", hex: "#FF8C00" },
  { name: "Hot Pink", hex: "#FF69B4" },
  { name: "Maroon", hex: "#800000" },
  { name: "Purple", hex: "#800080" },
  { name: "Lavender", hex: "#E6E6FA" },
  { name: "Grey", hex: "#808080" },
  { name: "Kelly Green", hex: "#4CBB17" },
  { name: "Indigo", hex: "#4B0082" },
  { name: "Cyan", hex: "#00CED1" },
  { name: "Midnight Blue", hex: "#191970" },
  { name: "Heather Grey", hex: "#B6B6B4" },
  { name: "White", hex: "#FFFFFF" },
  { name: "Black", hex: "#000000" },
];

// Default placement zones
const DEFAULT_FRONT: PlacementCoords = { x: 0.5, y: 0.42, scale: 0.38 };
const DEFAULT_BACK: PlacementCoords = { x: 0.5, y: 0.40, scale: 0.42 };

// Known real image mappings: type|subType|color|view -> URL
const KNOWN_IMAGES: Record<string, string> = {
  "T-Shirt|Washed T-Shirt|White|front": "/products/tshirt/gildan-white-front.png",
  "T-Shirt|Washed T-Shirt|White|back": "/products/tshirt/gildan-white-back.png",
  "T-Shirt|Oversized T-Shirt|White|front": "/products/tshirt/gildan-white-front.png",
  "T-Shirt|Oversized T-Shirt|White|back": "/products/tshirt/gildan-white-back.png",
  "T-Shirt|Women's T-Shirt|White|front": "/products/tshirt/gildan-white-front.png",
  "T-Shirt|Women's T-Shirt|White|back": "/products/tshirt/gildan-white-back.png",
  "Hoodie|Washed Hoodie|White|front": "/products/hoodie/gildan-hoodie-white-front.png",
  "Hoodie|Washed Hoodie|White|back": "/products/hoodie/gildan-hoodie-white-back.png",
  "Hoodie|Washed Zipped Hoodie|White|front": "/products/hoodie/gildan-hoodie-white-front.png",
  "Hoodie|Washed Zipped Hoodie|White|back": "/products/hoodie/gildan-hoodie-white-back.png",
};

// CSS filter values to colorize a white product mockup to the target color
// Format: { hueRotate (deg), saturate (%), brightness (%) }
export const COLOR_FILTERS: Record<ProductColor, { hueRotate: number; saturate: number; brightness: number } | null> = {
  "White": null, // no filter needed
  "Black": { hueRotate: 0, saturate: 0, brightness: 20 },
  "Charcoal": { hueRotate: 0, saturate: 10, brightness: 35 },
  "Navy": { hueRotate: 230, saturate: 300, brightness: 30 },
  "Olive": { hueRotate: 60, saturate: 200, brightness: 50 },
  "Cream": { hueRotate: 40, saturate: 30, brightness: 95 },
  "Red": { hueRotate: 0, saturate: 500, brightness: 55 },
  "Royal Blue": { hueRotate: 220, saturate: 400, brightness: 50 },
  "Yellow": { hueRotate: 45, saturate: 500, brightness: 85 },
  "Orange": { hueRotate: 25, saturate: 500, brightness: 65 },
  "Hot Pink": { hueRotate: 320, saturate: 400, brightness: 65 },
  "Maroon": { hueRotate: 350, saturate: 400, brightness: 30 },
  "Purple": { hueRotate: 280, saturate: 400, brightness: 40 },
  "Lavender": { hueRotate: 260, saturate: 80, brightness: 90 },
  "Grey": { hueRotate: 0, saturate: 0, brightness: 60 },
  "Kelly Green": { hueRotate: 100, saturate: 400, brightness: 50 },
  "Indigo": { hueRotate: 260, saturate: 500, brightness: 30 },
  "Cyan": { hueRotate: 180, saturate: 400, brightness: 65 },
  "Midnight Blue": { hueRotate: 230, saturate: 400, brightness: 20 },
  "Heather Grey": { hueRotate: 0, saturate: 5, brightness: 70 },
};

// Generate catalog entries for all products with common colors
function generateCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  const commonColors: ProductColor[] = ["Black", "White", "Navy", "Charcoal", "Grey"];

  for (const product of PRODUCTS) {
    const subTypes = SUB_PRODUCTS[product.type];
    const subs = subTypes.length > 0 ? subTypes : [product.type];

    for (const sub of subs) {
      for (const color of commonColors) {
        for (const view of ["front", "back"] as ProductView[]) {
          const key = `${product.type}|${sub}|${color}|${view}`;
          entries.push({
            type: product.type,
            subType: sub,
            color,
            view,
            filename: `${product.type.toLowerCase().replace(/\s/g, "-")}-${sub.toLowerCase().replace(/\s/g, "-")}-${color.toLowerCase().replace(/\s/g, "-")}-${view}.png`,
            placementZone: view === "front" ? DEFAULT_FRONT : DEFAULT_BACK,
            imageUrl: KNOWN_IMAGES[key] ?? null,
          });
        }
      }
    }
  }
  return entries;
}

// Singleton catalog service with O(1) lookups
class CatalogService {
  private entries: CatalogEntry[];
  private lookupMap: Map<string, CatalogEntry>;
  private subProductCache: Map<ProductType, string[]>;
  private colorCache: Map<string, ProductColor[]>;

  constructor() {
    this.entries = generateCatalog();
    this.lookupMap = new Map();
    this.subProductCache = new Map();
    this.colorCache = new Map();

    for (const entry of this.entries) {
      const key = `${entry.type}|${entry.subType}|${entry.color}|${entry.view}`;
      this.lookupMap.set(key, entry);
    }

    // Cache sub-products
    for (const [type, subs] of Object.entries(SUB_PRODUCTS)) {
      this.subProductCache.set(type as ProductType, subs);
    }

    // Cache available colors per product+subType
    for (const entry of this.entries) {
      const key = `${entry.type}|${entry.subType}`;
      if (!this.colorCache.has(key)) {
        this.colorCache.set(key, []);
      }
      const colors = this.colorCache.get(key)!;
      if (!colors.includes(entry.color)) {
        colors.push(entry.color);
      }
    }
  }

  findProduct(type: ProductType, subType: string, color: ProductColor, view: ProductView): CatalogEntry | undefined {
    return this.lookupMap.get(`${type}|${subType}|${color}|${view}`);
  }

  getSubProducts(type: ProductType): string[] {
    return this.subProductCache.get(type) || [];
  }

  getAvailableColors(type: ProductType, subType?: string): ProductColor[] {
    const sub = subType || (this.getSubProducts(type)[0] ?? type);
    return this.colorCache.get(`${type}|${sub}`) || [];
  }

  getDefaultSubProduct(type: ProductType): string {
    const subs = this.getSubProducts(type);
    return subs.length > 0 ? subs[0] : type;
  }
}

export const catalog = new CatalogService();
