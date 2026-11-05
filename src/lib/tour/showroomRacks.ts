// The racks of the shop for /showroom: one button per brand at the bottom of
// the walk ("სად წავიდეთ?"). Tapping one walks there by itself (autoWalk.ts),
// turns the view to the rack and opens its sheet (RackSheet: that brand's
// garment, its "from" price, "არჩევა" → the constructor).
//
// HOW THE STOPS WERE PICKED (2026-11-05): David photographed every rack from
// where the tour should stop and named it. Each was found on the walk's video
// frames: the window line, the display table, the hooks and the coat stand by
// eye, with David's notes ("TH = back of the Sol's rack", "the washed hoodies
// hang under the GILDAN hoodies", …); the five racks in the middle by matching
// the photo's background to the video and solving where the phone stood
// (feature matching + PnP), then checked on the frames. stop.t = forward time
// on the walk where the camera passes closest; yawDeg/pitchDeg = where the view
// turns to see it. No football kits (official logos; old models) — 2026-11-05.

import type { ProductType } from "@/lib/catalog";

export interface RackItem {
  product: ProductType;
  /** Exact SUB_PRODUCTS string (catalog.ts); for a product without brands (Tote Bag) the product itself. */
  brand: string;
}

export interface ShowroomRack {
  id: string;
  /** Button label and sheet title. */
  title: string;
  /** What hangs there; "catalog" = the yellow rack: the whole design catalog. */
  items: readonly RackItem[] | "catalog";
  /**
   * Where the walk stops (forward time), where the view then looks (video-frame
   * yaw) and how far down (pitch; a rack right beside the walk hangs low in the picture).
   */
  stop: { t: number; yawDeg: number; pitchDeg?: number };
}

const one = (id: string, title: string, product: ProductType, brand: string, t: number, yawDeg: number, pitchDeg?: number): ShowroomRack => ({
  id,
  title,
  items: [{ product, brand }],
  stop: { t, yawDeg, pitchDeg },
});

export const SHOWROOM_RACKS: readonly ShowroomRack[] = [
  // the middle racks (T-shirts)
  one("gildan", "GILDAN", "T-Shirt", "GILDAN", 158.8, -95, -22),
  one("gildan-kids", "GILDAN KIDS", "T-Shirt", "GILDAN KIDS", 160, -90, -22),
  one("polo", "Polo", "T-Shirt", "Polo", 189.4, 90, -28),
  one("sols", "Sol's", "T-Shirt", "Sol's", 161.6, -90, -22),
  one("th", "TH", "T-Shirt", "TH", 169.6, 95, -28),
  // the window line, from the entrance door to the maika.ge sign
  one("gildan-hoodie", "GILDAN ჰუდი", "Hoodie", "GILDAN Hoodie", 172, 138, -12),
  one("washed-hoodie", "Washed ჰუდი", "Hoodie", "Premium Washed Hoodie", 172, 146, -22),
  one("washed-tee", "Washed მაისური", "T-Shirt", "JEL T-Shirt", 172, 158, -15),
  one("oversize", "Oversize", "T-Shirt", "Oversize", 173, 172, -15),
  one("giordano", "GIORDANO", "T-Shirt", "GIORDANO", 174, -160, -25),
  one("hummer", "GILDAN HUMMER", "T-Shirt", "GILDAN HUMMER", 176, -125, -25),
  // the window display table at the far end
  one("nike", "NIKE", "T-Shirt", "NIKE", 40, 165, -25),
  one("khundadze", "Khundadze", "T-Shirt", "Khundadze", 38, -170, -15),
  // the wall hooks beside the skeleton, the yellow rack, the hooks under the jerseys
  one("jel-zipper", "JEL Washed Zipper", "Hoodie", "JEL Zipper", 52, -40, -15),
  one("jel-standard-zipper", "JEL Standard Zipper", "Hoodie", "JEL Standard Zipper", 54, -28, -15),
  { id: "catalog", title: "მთელი კატალოგი", items: "catalog", stop: { t: 56, yawDeg: -12, pitchDeg: -10 } },
  one("bomber", "GILDAN Bomber", "Hoodie", "GILDAN Bomber", 226, -62, -10),
  // the yellow coat stand beside the blue door
  one("tote", "ნაჭრის ჩანთები", "Tote Bag", "Tote Bag", 148, 48, -5),
];
