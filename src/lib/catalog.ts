// Product catalog types and data

export type ProductType =
  | "Hoodie" | "T-Shirt" | "Tote Bag" | "Cap" | "Apron" | "Phone Case" | "Mug";

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
  { type: "Mug", icon: "☕", description: "Morning favorite" },
];

// Brand (sub-product) definitions per product type
export const SUB_PRODUCTS: Record<ProductType, string[]> = {
  "T-Shirt": ["GILDAN", "GILDAN HUMMER", "TH", "JEL T-Shirt", "GIORDANO", "Khundadze", "NIKE", "Polo"],
  "Hoodie": ["GILDAN Hoodie", "Premium Hoodie", "JEL Standard Hoodie", "JEL Zipper", "JEL Standard Zipper", "GILDAN Bomber"],
  "Tote Bag": [],
  "Cap": [],
  "Apron": [],
  "Phone Case": [],
  "Mug": [],
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
  "Premium Hoodie": ["Black", "Gray", "Khaki", "Pink", "Purple"],
  "JEL Standard Hoodie": ["White", "Black", "Red", "Burgundy", "Electric Blue", "Dark Navy", "Light Gray"],
  "JEL Zipper": ["Black", "Dark Navy", "Gray"],
  "JEL Standard Zipper": ["Black", "Dark Navy", "Light Gray Melange", "Red"],
  "GILDAN Bomber": ["Black", "White", "Red", "Standard Blue", "Brown"],

  // Standalone products (no sub-brands)
  "Cap": ["White", "Black", "Beige", "Light Gray", "Red", "Electric Blue", "Dark Navy", "Yellow", "Orange", "Light Blue", "Standard Blue", "Burgundy", "Gray", "Lime", "Purple"],
  "Apron": ["White", "Black"],
  "Phone Case": [],
  "Tote Bag": ["White", "Black", "Cream", "Dark Navy", "Electric Blue", "Turquoise", "Green", "Lime", "Pink", "Red", "Burgundy", "Purple"],
  "Mug": ["White"],
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
const HOODIE_FRONT: PlacementCoords = { x: 0.50, y: 0.51, scale: 0.28, scaleY: 0.28 };
const HOODIE_BACK: PlacementCoords = { x: 0.5, y: 0.48, scale: 0.28, scaleY: 0.28 };

// Tote Bag-specific: move design zone down by 18%
const TOTE_BAG_FRONT: PlacementCoords = { ...DEFAULT_FRONT, y: DEFAULT_FRONT.y + 0.18 };
const TOTE_BAG_BACK: PlacementCoords = { ...DEFAULT_BACK, y: DEFAULT_BACK.y + 0.18 };

// Mug-specific: shift design left by 8%
const MUG_FRONT: PlacementCoords = { ...DEFAULT_FRONT, x: DEFAULT_FRONT.x - 0.08 };

// Known real image mappings: type|subType|color|view -> URL
const KNOWN_IMAGES: Record<string, string> = {
  // T-Shirt brands
  "T-Shirt|GILDAN|White|front": "/products/tshirt/gildan-white-front.png",
  "T-Shirt|GILDAN|White|back": "/products/tshirt/gildan-white-back.png",
  "T-Shirt|GILDAN HUMMER|White|front": "/products/tshirt/gildan-hummer-white-front.png",
  "T-Shirt|GILDAN HUMMER|White|back": "/products/tshirt/gildan-hummer-white-back.png",
  "T-Shirt|GIORDANO|White|front": "/products/tshirt/giordano-white-front.png",
  "T-Shirt|GIORDANO|White|back": "/products/tshirt/giordano-white-back.png",
  "T-Shirt|Khundadze|White|front": "/products/tshirt/khundadze-white-front.png",
  "T-Shirt|Khundadze|White|back": "/products/tshirt/khundadze-white-back.png",
  "T-Shirt|NIKE|White|front": "/products/tshirt/nike-white-front.png",
  "T-Shirt|NIKE|White|back": "/products/tshirt/nike-white-back.png",
  "T-Shirt|Polo|White|front": "/products/tshirt/polo-white-front.png",
  "T-Shirt|Polo|White|back": "/products/tshirt/polo-white-back.png",
  "T-Shirt|TH|White|front": "/products/tshirt/th-white-front.png",
  "T-Shirt|TH|White|back": "/products/tshirt/th-white-back.png",
  "T-Shirt|JEL T-Shirt|Black|front": "/products/tshirt/jel-tshirt-black-front.png",
  "T-Shirt|JEL T-Shirt|Black|back": "/products/tshirt/jel-tshirt-black-back.png",
  "T-Shirt|JEL T-Shirt|Purple|front": "/products/tshirt/jel-tshirt-purple-front.png",
  "T-Shirt|JEL T-Shirt|Purple|back": "/products/tshirt/jel-tshirt-purple-back.png",
  "T-Shirt|JEL T-Shirt|Gray|front": "/products/tshirt/jel-tshirt-gray-front.png",
  "T-Shirt|JEL T-Shirt|Gray|back": "/products/tshirt/jel-tshirt-gray-back.png",
  "T-Shirt|JEL T-Shirt|Cream|front": "/products/tshirt/jel-tshirt-cream-front.png",
  "T-Shirt|JEL T-Shirt|Cream|back": "/products/tshirt/jel-tshirt-cream-back.png",
  "T-Shirt|JEL T-Shirt|Pink|front": "/products/tshirt/jel-tshirt-pink-front.png",
  "T-Shirt|JEL T-Shirt|Pink|back": "/products/tshirt/jel-tshirt-pink-back.png",
  "T-Shirt|JEL T-Shirt|Electric Blue|front": "/products/tshirt/jel-tshirt-blue-front.png",
  "T-Shirt|JEL T-Shirt|Electric Blue|back": "/products/tshirt/jel-tshirt-blue-back.png",
  "T-Shirt|JEL T-Shirt|Khaki|front": "/products/tshirt/jel-tshirt-khaki-front.png",
  "T-Shirt|JEL T-Shirt|Khaki|back": "/products/tshirt/jel-tshirt-khaki-back.png",

  // Hoodie brands
  "Hoodie|GILDAN Hoodie|White|front": "/products/hoodie/gildan-hoodie-white-front.png.png",
  "Hoodie|GILDAN Hoodie|White|back": "/products/hoodie/gildan-hoodie-white-back.png.png",
  "Hoodie|GILDAN Hoodie|Black|front": "/products/hoodie/gildan-hoodie-black-front.png.png",
  "Hoodie|GILDAN Hoodie|Black|back": "/products/hoodie/gildan-hoodie-black-back.png.png",
  "Hoodie|Premium Hoodie|Black|front": "/products/hoodie/jel-hoodie-black-front.png.png",
  "Hoodie|Premium Hoodie|Black|back": "/products/hoodie/jel-hoodie-black-back.png.png",
  "Hoodie|Premium Hoodie|Pink|front": "/products/hoodie/jel-hoodie-pink-front.png.png",
  "Hoodie|Premium Hoodie|Pink|back": "/products/hoodie/jel-hoodie-pink-back.png.png",
  "Hoodie|Premium Hoodie|Purple|front": "/products/hoodie/jel-hoodie-purple-front.png",
  "Hoodie|Premium Hoodie|Purple|back": "/products/hoodie/jel-hoodie-purple-back.png",
  "Hoodie|Premium Hoodie|Khaki|front": "/products/hoodie/jel-hoodie-khaki-front.png.png",
  "Hoodie|Premium Hoodie|Khaki|back": "/products/hoodie/jel-hoodie-khaki-back.png.png",
  "Hoodie|Premium Hoodie|Gray|front": "/products/hoodie/jel-hoodie-lightgray-front.png.png",
  "Hoodie|Premium Hoodie|Gray|back": "/products/hoodie/jel-hoodie-lightgray-back.png.png",
  "Hoodie|JEL Zipper|Black|front": "/products/hoodie/jel-zipper-black-front.png.png",
  "Hoodie|JEL Zipper|Black|back": "/products/hoodie/jel-zipper-black-back.png.png",
  "Hoodie|JEL Zipper|Dark Navy|front": "/products/hoodie/jel-zipper-navy-front.png.png",
  "Hoodie|JEL Zipper|Dark Navy|back": "/products/hoodie/jel-zipper-navy-back.png.png",
  "Hoodie|JEL Zipper|Gray|front": "/products/hoodie/jel-zipper-gray-front.png.png",
  "Hoodie|JEL Zipper|Gray|back": "/products/hoodie/jel-zipper-gray-back.png.png",
  "Hoodie|JEL Standard Zipper|Black|front": "/products/hoodie/jel-standard-zipper-black-front.png",
  "Hoodie|JEL Standard Zipper|Black|back": "/products/hoodie/jel-standard-zipper-black-back.png",
  "Hoodie|JEL Standard Zipper|Dark Navy|front": "/products/hoodie/jel-standard-zipper-navy-front.png",
  "Hoodie|JEL Standard Zipper|Dark Navy|back": "/products/hoodie/jel-standard-zipper-navy-back.png",
  "Hoodie|JEL Standard Zipper|Light Gray Melange|front": "/products/hoodie/jel-standard-zipper-lightgray-front.png",
  "Hoodie|JEL Standard Zipper|Light Gray Melange|back": "/products/hoodie/jel-standard-zipper-lightgray-back.png",
  "Hoodie|JEL Standard Zipper|Red|front": "/products/hoodie/jel-standard-zipper-red-front.png",
  "Hoodie|JEL Standard Zipper|Red|back": "/products/hoodie/jel-standard-zipper-red-back.png",
  "Hoodie|JEL Standard Hoodie|White|front": "/products/hoodie/jel-standard-hoodie-white-front.png.png",
  "Hoodie|JEL Standard Hoodie|White|back": "/products/hoodie/jel-standard-hoodie-white-back.png.png",
  "Hoodie|JEL Standard Hoodie|Black|front": "/products/hoodie/jel-standard-hoodie-black-front.png.png",
  "Hoodie|JEL Standard Hoodie|Black|back": "/products/hoodie/jel-standard-hoodie-black-back.png.png",
  "Hoodie|GILDAN Bomber|White|front": "/products/hoodie/gildan-bomber-white-front.png.png",
  "Hoodie|GILDAN Bomber|White|back": "/products/hoodie/gildan-bomber-white-back.png.png",
  "Hoodie|GILDAN Bomber|Black|front": "/products/hoodie/gildan-bomber-black-front.png.png",
  "Hoodie|GILDAN Bomber|Black|back": "/products/hoodie/gildan-bomber-black-back.png.png",

  // Standalone products
  "Cap|Cap|White|front": "/products/cap/CAP.png",
  "Apron|Apron|White|front": "/products/apron/APRON.png",
  "Tote Bag|Tote Bag|White|front": "/products/totebag/TOTE%20BAG.png",
  "Phone Case|Phone Case|White|front": "/products/phonecase/PHONE_CASE.png",
  "Mug|Mug|White|front": "/products/mug/MUG.png",
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
              : product.type === "Tote Bag"
                ? (view === "front" ? TOTE_BAG_FRONT : TOTE_BAG_BACK)
                : product.type === "Mug"
                  ? MUG_FRONT
                  : (view === "front" ? DEFAULT_FRONT : DEFAULT_BACK),
            imageUrl: KNOWN_IMAGES[key] || null,
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

  /** Find the image to display: exact color match (no colorization) or base image for tinting */
  findImageForColor(type: ProductType, subType: string, color: ProductColor, view: ProductView): { entry: CatalogEntry; isExact: boolean } | undefined {
    // 1. Try exact color match — use as-is, no colorization needed
    const exact = this.lookupMap.get(`${type}|${subType}|${color}|${view}`);
    if (exact?.imageUrl) return { entry: exact, isExact: true };

    // 2. Try White base for colorization
    const white = this.lookupMap.get(`${type}|${subType}|White|${view}`);
    if (white?.imageUrl) return { entry: white, isExact: false };

    // 3. Fallback: any color with a real image
    const colors = this.getAvailableColors(type, subType);
    for (const c of colors) {
      const entry = this.lookupMap.get(`${type}|${subType}|${c}|${view}`);
      if (entry?.imageUrl) return { entry, isExact: false };
    }
    return undefined;
  }

  /** @deprecated Use findImageForColor instead */
  findBaseImage(type: ProductType, subType: string, view: ProductView): CatalogEntry | undefined {
    const result = this.findImageForColor(type, subType, "White" as ProductColor, view);
    return result?.entry;
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
