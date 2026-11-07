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
// (feature matching + PnP), then checked on the frames. stop.t = a moment of
// the walk ~1.4 m in front of the rack's face (picked on the floor path,
// posM; David 2026-11-07: "every rack, close"), yawDeg = toward it; the view
// then tilts only a little down (VideoWalk arrivePitch) — below ~−25° near the
// camera the picture is smeared (the camera was held just above David's head).
// Polo stays at 2.5 m (its rack is only seen whole from there). No football
// kits (official logos; old models) — 2026-11-05.

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
   * yaw) and, if set, its tilt (default: the walking tilt).
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
  one("gildan", "GILDAN", "T-Shirt", "GILDAN", 159.0, -95),
  one("gildan-kids", "GILDAN KIDS", "T-Shirt", "GILDAN KIDS", 74.2, -104),
  one("polo", "Polo", "T-Shirt", "Polo", 241.8, 70),
  one("sols", "Sol's", "T-Shirt", "Sol's", 253.6, -110),
  one("th", "TH", "T-Shirt", "TH", 224.6, 128),
  // the window line, from the entrance door to the maika.ge sign
  one("gildan-hoodie", "GILDAN ჰუდი", "Hoodie", "GILDAN Hoodie", 102.0, 154),
  one("washed-hoodie", "Washed ჰუდი", "Hoodie", "Premium Washed Hoodie", 245.6, 159),
  one("washed-tee", "Washed მაისური", "T-Shirt", "JEL T-Shirt", 102.2, 166),
  one("oversize", "Oversize", "T-Shirt", "Oversize", 103.2, 179),
  one("giordano", "GIORDANO", "T-Shirt", "GIORDANO", 173.0, -163),
  one("hummer", "GILDAN HUMMER", "T-Shirt", "GILDAN HUMMER", 174.2, -116),
  // the window display table at the far end
  one("nike", "NIKE", "T-Shirt", "NIKE", 118.8, 168),
  one("khundadze", "Khundadze", "T-Shirt", "Khundadze", 121.6, -172),
  // the wall hooks beside the skeleton, the yellow rack, the hooks under the jerseys
  one("jel-zipper", "JEL Washed Zipper", "Hoodie", "JEL Zipper", 238.6, -38),
  one("jel-standard-zipper", "JEL Standard Zipper", "Hoodie", "JEL Standard Zipper", 53.6, -23),
  { id: "catalog", title: "მთელი კატალოგი", items: "catalog", stop: { t: 55.2, yawDeg: 3 } },
  one("bomber", "GILDAN Bomber", "Hoodie", "GILDAN Bomber", 226.2, -61),
  // the yellow coat stand beside the blue door
  one("tote", "ნაჭრის ჩანთები", "Tote Bag", "Tote Bag", 148, 48),
];
