// Product catalog types and data

export type ProductType =
  | "Hoodie" | "T-Shirt" | "Tote Bag" | "Cap" | "Apron" | "Phone Case";

export type ProductSubType = string;

export type ProductColor =
  | "White" | "Black" | "Beige" | "Light Gray" | "Red" | "Electric Blue"
  | "Dark Navy" | "Yellow" | "Orange" | "Light Blue" | "Standard Blue"
  | "Burgundy" | "Gray" | "Lime" | "Purple" | "Light Gray Melange"
  | "Cream" | "Light Cream" | "Pink" | "Khaki" | "Brown" | "Turquoise" | "Green";

export type ProductView = "front" | "back";

export interface PlacementCoords {
  x: number;
  y: number;
  scale: number;
  scaleY?: number;
}

export interface CatalogEntry {
  type: ProductType;
  subType: string;
  color: ProductColor;
  view: ProductView;
  filename: string;
  placementZone: PlacementCoords;
  imageUrl: string | null;
}

export interface ProductInfo {
  type: ProductType;
  icon: string;
  description: string;
}

// Product metadata
export const PRODUCTS: ProductInfo[] = [
  { type: "T-Shirt", icon: "👕", description: "Everyday essential" },
  { type: "Hoodie", icon: "🧥", description: "Classic pullover" },
  { type: "Tote Bag", icon: "👜", description: "Carry your style" },
  { type: "Cap", icon: "🧢", description: "Top it off" },
  { type: "Apron", icon: "👨‍🍳", description: "Creative canvas" },
  { type: "Phone Case", icon: "📱", description: "Protect in style" },
];

// Brand (sub-product) definitions per product type
export const SUB_PRODUCTS: Record<ProductType, string[]> = {
  "T-Shirt": ["GILDAN", "GILDAN HUMMER", "TH", "JEL T-Shirt", "GIORDANO", "Khundadze", "NIKE", "Polo"],
  "Hoodie": ["GILDAN Hoodie", "JEL Hoodie", "JEL Standard Hoodie", "JEL Zipper", "JEL Standard Zipper", "GILDAN Bomber"],
  "Tote Bag": [],
  "Cap": [],
  "Apron": [],
  "Phone Case": [],
};

// Per-brand color availability
export const BRAND_COLORS: Record<string, ProductColor[]> = {
  // T-Shirt brands
  "GILDAN": ["White", "Black", "Beige", "Light Gray", "Red", "Electric Blue", "Dark Navy", "Yellow", "Orange", "Light Blue", "Standard Blue", "Burgundy", "Gray", "Lime", "Purple"],
  "GILDAN HUMMER": ["White", "Black", "Electric Blue", "Light Gray Melange"],
  "TH": ["White", "Black"],
  "JEL T-Shirt": ["Black", "Purple", "Gray", "Light Cream", "Pink", "Electric Blue", "Khaki"],
  "GIORDANO": ["White", "Black"],
  "Khundadze": ["White", "Black"],
  "NIKE": ["Dark Navy", "White", "Cream"],
  "Polo": ["White", "Black", "Beige", "Light Gray", "Red", "Electric Blue", "Dark Navy", "Yellow", "Orange", "Light Blue", "Standard Blue", "Burgundy", "Gray", "Lime", "Purple"],

  // Hoodie brands
  "GILDAN Hoodie": ["White", "Black", "Beige", "Light Gray", "Red", "Electric Blue", "Dark Navy", "Yellow", "Orange", "Light Blue", "Standard Blue", "Burgundy", "Gray", "Lime", "Purple"],
  "JEL Hoodie": ["Black", "Gray", "Khaki"],
  "JEL Standard Hoodie": ["Black", "Dark Navy", "Light Gray Melange", "Red"],
  "JEL Zipper": ["Black", "Dark Navy", "Gray"],
  "JEL Standard Zipper": ["Black", "Dark Navy", "Light Gray Melange", "Red"],
  "GILDAN Bomber": ["Black", "White", "Red", "Standard Blue", "Brown"],

  // Standalone products (no sub-brands)
  "Cap": ["White", "Black", "Beige", "Light Gray", "Red", "Electric Blue", "Dark Navy", "Yellow", "Orange", "Light Blue", "Standard Blue", "Burgundy", "Gray", "Lime", "Purple"],
  "Apron": ["Black"],
  "Phone Case": [],
  "Tote Bag": ["Black", "Cream", "Dark Navy", "Electric Blue", "Turquoise", "Green", "Lime", "Pink", "Red", "Burgundy", "Purple"],
};

// All colors with display hex values
export const COLORS: { name: ProductColor; hex: string }[] = [
  { name: "White", hex: "#FFFFFF" },
  { name: "Black", hex: "#000000" },
  { name: "Beige", hex: "#F5F0DC" },
  { name: "Light Gray", hex: "#C8C8C8" },
  { name: "Light Gray Melange", hex: "#B8B8B8" },
  { name: "Gray", hex: "#808080" },
  { name: "Cream", hex: "#FFFDD0" },
  { name: "Light Cream", hex: "#FFF8E7" },
  { name: "Red", hex: "#E21818" },
  { name: "Burgundy", hex: "#800020" },
  { name: "Pink", hex: "#FF69B4" },
  { name: "Orange", hex: "#FF8C00" },
  { name: "Yellow", hex: "#FFD700" },
  { name: "Lime", hex: "#32CD32" },
  { name: "Green", hex: "#228B22" },
  { name: "Turquoise", hex: "#40E0D0" },
  { name: "Light Blue", hex: "#87CEEB" },
  { name: "Standard Blue", hex: "#4169E1" },
  { name: "Electric Blue", hex: "#0066FF" },
  { name: "Dark Navy", hex: "#0A1128" },
  { name: "Purple", hex: "#800080" },
  { name: "Khaki", hex: "#C3B091" },
  { name: "Brown", hex: "#654321" },
];

// Default placement zones
const DEFAULT_FRONT: PlacementCoords = { x: 0.5, y: 0.42, scale: 0.38 };
const DEFAULT_BACK: PlacementCoords = { x: 0.5, y: 0.40, scale: 0.42 };

// Hoodie-specific: design sits lower on the chest, below collar/zipper
const HOODIE_FRONT: PlacementCoords = { x: 0.50, y: 0.61, scale: 0.28, scaleY: 0.28 };
const HOODIE_BACK: PlacementCoords = { x: 0.5, y: 0.48, scale: 0.52 };

// Known real image mappings: type|subType|color|view -> URL
const KNOWN_IMAGES: Record<string, string> = {
  // T-Shirt brands
  "T-Shirt|GILDAN|White|front": "/products/tshirt/gildan-white-front.png",
  "T-Shirt|GILDAN|White|back": "/products/tshirt/gildan-white-back.png",
  "T-Shirt|GILDAN HUMMER|White|front": "/products/tshirt/gildan-hummer-white-front.png",
  "T-Shirt|GILDAN HUMMER|White|back": "/products/tshirt/gildan-hummer-white-back.png",
  "T-Shirt|GIORDANO|White|front": "/products/tshirt/giordano-white-front.png",
  "T-Shirt|GIORDANO|White|back": "/products/tshirt/giordano-white-back.png",
  "T-Shirt|TH|White|front": "/products/tshirt/th-white-front.png",
  "T-Shirt|TH|White|back": "/products/tshirt/th-white-back.png",
  "T-Shirt|JEL T-Shirt|White|front": "/products/tshirt/jel-tshirt-white-front.png",
  "T-Shirt|JEL T-Shirt|White|back": "/products/tshirt/jel-tshirt-white-back.png",
  "T-Shirt|Khundadze|White|front": "/products/tshirt/khundadze-white-front.png",
  "T-Shirt|Khundadze|White|back": "/products/tshirt/khundadze-white-back.png",
  "T-Shirt|NIKE|White|front": "/products/tshirt/nike-white-front.png",
  "T-Shirt|NIKE|White|back": "/products/tshirt/nike-white-back.png",
  "T-Shirt|Polo|White|front": "/products/tshirt/polo-white-front.png",
  "T-Shirt|Polo|White|back": "/products/tshirt/polo-white-back.png",

  // Hoodie brands
  "Hoodie|GILDAN Hoodie|White|front": "/products/hoodie/gildan-hoodie-white-front.png",
  "Hoodie|GILDAN Hoodie|White|back": "/products/hoodie/gildan-hoodie-white-back.png",
  "Hoodie|JEL Hoodie|White|front": "/products/hoodie/jel-hoodie-white-front.png",
  "Hoodie|JEL Hoodie|White|back": "/products/hoodie/jel-hoodie-white-back.png",
  "Hoodie|JEL Standard Hoodie|White|front": "/products/hoodie/jel-standard-hoodie-white-front.png",
  "Hoodie|JEL Standard Hoodie|White|back": "/products/hoodie/jel-standard-hoodie-white-back.png",
  "Hoodie|JEL Zipper|White|front": "/products/hoodie/jel-zipper-white-front.png",
  "Hoodie|JEL Zipper|White|back": "/products/hoodie/jel-zipper-white-back.png",
  "Hoodie|JEL Standard Zipper|White|front": "/products/hoodie/jel-standard-zipper-white-front.png",
  "Hoodie|JEL Standard Zipper|White|back": "/products/hoodie/jel-standard-zipper-white-back.png",
  "Hoodie|GILDAN Bomber|White|front": "/products/hoodie/gildan-bomber-white-front.png",
  "Hoodie|GILDAN Bomber|White|back": "/products/hoodie/gildan-bomber-white-back.png",

  // Standalone products
  "Cap|Cap|White|front": "/products/cap/cap-white-front.png",
  "Apron|Apron|White|front": "/products/apron/apron-white-front.png",
  "Tote Bag|Tote Bag|White|front": "/products/totebag/totebag-white-front.png",
  "Tote Bag|Tote Bag|White|back": "/products/totebag/totebag-white-back.png",
};

// CSS filter strings to colorize a white product mockup to the target color
export const COLOR_FILTERS: Record<ProductColor, string> = {
  "White": "brightness(1) saturate(0)",
  "Black": "brightness(0.15) saturate(0)",
  "Beige": "sepia(0.4) brightness(1.1) saturate(0.6)",
  "Light Gray": "brightness(0.85) saturate(0)",
  "Light Gray Melange": "brightness(0.8) saturate(0.1)",
  "Gray": "brightness(0.6) saturate(0)",
  "Cream": "brightness(1.05) sepia(0.3) saturate(0.6)",
  "Light Cream": "brightness(1.1) sepia(0.2) saturate(0.5)",
  "Red": "brightness(0.9) saturate(3) hue-rotate(0deg)",
  "Burgundy": "brightness(0.6) saturate(2) hue-rotate(330deg)",
  "Pink": "brightness(1) saturate(2) hue-rotate(320deg)",
  "Orange": "brightness(1) saturate(3) hue-rotate(20deg)",
  "Yellow": "brightness(1.1) saturate(3) hue-rotate(45deg)",
  "Lime": "brightness(1) saturate(3) hue-rotate(80deg)",
  "Green": "brightness(0.8) saturate(3) hue-rotate(110deg)",
  "Turquoise": "brightness(0.9) saturate(3) hue-rotate(165deg)",
  "Light Blue": "brightness(1.1) saturate(2) hue-rotate(190deg)",
  "Standard Blue": "brightness(0.8) saturate(3) hue-rotate(200deg)",
  "Electric Blue": "brightness(1) saturate(4) hue-rotate(200deg)",
  "Dark Navy": "brightness(0.4) saturate(2) hue-rotate(210deg)",
  "Purple": "brightness(0.7) saturate(2) hue-rotate(270deg)",
  "Khaki": "sepia(0.6) brightness(0.9) saturate(0.8)",
  "Brown": "sepia(0.8) brightness(0.7) saturate(1.2)",
};

// Generate catalog entries
function generateCatalog(): CatalogEntry[] {
  const entries: CatalogEntry[] = [];

  for (const product of PRODUCTS) {
    const subTypes = SUB_PRODUCTS[product.type];
    const subs = subTypes.length > 0 ? subTypes : [product.type];

    for (const sub of subs) {
      const brandColors = BRAND_COLORS[sub] || [];
      if (brandColors.length === 0 && product.type === "Phone Case") {
        // Phone case has no color variants, add one default entry
        for (const view of ["front", "back"] as ProductView[]) {
          entries.push({
            type: product.type,
            subType: sub,
            color: "Black" as ProductColor,
            view,
            filename: `phone-case-${view}.png`,
            placementZone: view === "front" ? DEFAULT_FRONT : DEFAULT_BACK,
            imageUrl: null,
          });
        }
        continue;
      }

      for (const color of brandColors) {
        for (const view of ["front", "back"] as ProductView[]) {
          const key = `${product.type}|${sub}|${color}|${view}`;
          entries.push({
            type: product.type,
            subType: sub,
            color,
            view,
            filename: `${product.type.toLowerCase().replace(/\s/g, "-")}-${sub.toLowerCase().replace(/\s/g, "-")}-${color.toLowerCase().replace(/\s/g, "-")}-${view}.png`,
            placementZone: product.type === "Hoodie"
              ? (view === "front" ? HOODIE_FRONT : HOODIE_BACK)
              : (view === "front" ? DEFAULT_FRONT : DEFAULT_BACK),
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

    for (const [type, subs] of Object.entries(SUB_PRODUCTS)) {
      this.subProductCache.set(type as ProductType, subs);
    }

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
