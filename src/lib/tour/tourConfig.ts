// The /showroom 360° tour: six equirectangular panoramas (Insta360 X4) shot
// along the shop aisle, linked as a chain s1 ↔ s2 ↔ … ↔ s6.
//
// ANGLES (degrees)
//   Every yaw here is a WORLD yaw: 0 is the same physical direction in every
//   photo, + turns right (clockwise seen from above). World 0 is "into the
//   shop" as seen from the entrance (s1 → s2, toward the counter with the
//   football-pitch panel).
//
//   northOffsetDeg — the yaw INSIDE the photo (0 = image centre, + to the
//     right) that faces world 0. The camera wasn't always pointed the same
//     way; this undoes it: worldYaw = photoYaw − northOffsetDeg.
//   links[].yawDeg / pitchDeg — world direction of the floor arrow toward the
//     neighbour (pitch − is down). The arrow is also where the view turns to
//     before stepping, and the stick picks the link closest to where you look.
//
// HOW THE FIRST GUESSES WERE MADE (2026-10-17, to be tuned with /showroom?tune=1)
//   Neighbouring photos were matched feature by feature (SIFT, ~380–840
//   matches per pair, 80 % inliers) and the relative camera pose solved from
//   the matched directions (essential matrix on the sphere). That gives, per
//   pair, the heading change between the two photos and the direction of the
//   neighbour's tripod. Cross-checks over two steps (s1→s3, s2→s4, s3→s5,
//   s4→s6) agree with the summed single steps to ±0.3°, s1→s6 to 2.3°; the
//   photos are level to ≤1.2°. Visual checks: the blue door in the clock
//   wall is at world +35° from s1 (close by, off to the side) and +60…+80°
//   (east) from s2…s6; the street windows are behind s1 (≈ 180°, south); in
//   s1 and s2 a white floor circle sits exactly on the estimated s1↔s2 line.
//   Path in world terms: s1 → s2 north toward the counter, s2 → s3 north-west,
//   s3 → s4 → s5 west along the aisle, s5 → s6 south toward the street windows.
//   Link pitch: the neighbour's tripod spot itself lies ≈ −42…−45° down (s1↔s2
//   measured on the floor circle), below the bottom of the screen at the
//   default zoom; the arrows sit at −32° so they're in view.

export type TourNodeId = "s1" | "s2" | "s3" | "s4" | "s5" | "s6";

export interface TourLink {
  to: TourNodeId;
  /** World yaw of the arrow / direction of travel. */
  yawDeg: number;
  /** Pitch of the arrow (− = down). */
  pitchDeg: number;
}

export interface TourNode {
  id: TourNodeId;
  /** Georgian name (tuning overlay, accessibility). */
  label: string;
  panorama: { "6k": string; "4k": string };
  northOffsetDeg: number;
  links: TourLink[];
}

const pano = (id: TourNodeId) => ({ "6k": `/tour/360/${id}-6k.jpg`, "4k": `/tour/360/${id}-4k.jpg` });

/** Height of the floor arrows (see the note above). */
const ARROW_PITCH = -32;

export const TOUR_NODES: TourNode[] = [
  {
    id: "s1",
    label: "შესასვლელი — დივანი და ტელეფონები",
    panorama: pano("s1"),
    northOffsetDeg: 0,
    links: [{ to: "s2", yawDeg: 0.2, pitchDeg: ARROW_PITCH }],
  },
  {
    id: "s2",
    label: "დახლის წინ",
    panorama: pano("s2"),
    northOffsetDeg: -0.1,
    links: [
      { to: "s1", yawDeg: -179.9, pitchDeg: ARROW_PITCH },
      { to: "s3", yawDeg: -61.9, pitchDeg: ARROW_PITCH },
    ],
  },
  {
    id: "s3",
    label: "დახლი და ყვითელი საკიდი",
    panorama: pano("s3"),
    northOffsetDeg: -98.1,
    links: [
      { to: "s2", yawDeg: 118.2, pitchDeg: ARROW_PITCH },
      { to: "s4", yawDeg: -89.4, pitchDeg: ARROW_PITCH },
    ],
  },
  {
    id: "s4",
    label: "გრძელი ყვითელი საკიდი",
    panorama: pano("s4"),
    northOffsetDeg: -92.3,
    links: [
      { to: "s3", yawDeg: 90.6, pitchDeg: ARROW_PITCH },
      { to: "s5", yawDeg: -85.7, pitchDeg: ARROW_PITCH },
    ],
  },
  {
    id: "s5",
    label: "ჰუდების საკიდებს შორის",
    panorama: pano("s5"),
    northOffsetDeg: -99.2,
    links: [
      { to: "s4", yawDeg: 94.3, pitchDeg: ARROW_PITCH },
      { to: "s6", yawDeg: -179.1, pitchDeg: ARROW_PITCH },
    ],
  },
  {
    id: "s6",
    label: "ჰუდების პანელი და რადიოს კარადა",
    panorama: pano("s6"),
    northOffsetDeg: -101.2,
    links: [{ to: "s5", yawDeg: 1.0, pitchDeg: ARROW_PITCH }],
  },
];

export const TOUR = {
  startNodeId: "s1" as TourNodeId,
  /** Start looking into the shop toward s2. */
  startYawDeg: 0.2,
  startPitchDeg: -6,
  /** Tripod cover at the nadir: maika.ge logo disc, this many degrees across. */
  nadirLogo: { url: "/tour/nadir-logo.webp", widthDeg: 30 },
  /**
   * One step (TourViewer). Zoom values are PSV zoom levels (0…100) relative
   * to the zoom when the step starts.
   *   1. walk out (outMs): the camera pushes into the current photo by
   *      outZoom, like taking the first stride;
   *   2. the current frame is frozen on top, the next photo is switched in
   *      underneath starting inFromZoom wider, and over blendMs the frozen
   *      frame keeps growing (to overlayScaleTo) and fades out while the next
   *      photo zooms back to normal — the picture keeps moving forward.
   *   Head bob over the whole step (two footfalls): bobPx down, bobRollDeg
   *   sway, bobScale to hide the moved edges. Walking backward reverses the
   *   zooms (backOutZoom / backInFromZoom / backOverlayScaleTo).
   */
  walk: {
    outMs: 420,
    outZoom: 16,
    blendMs: 520,
    inFromZoom: -8,
    overlayScaleTo: 1.18,
    backOutZoom: -12,
    backInFromZoom: 14,
    backOverlayScaleTo: 0.9,
    bobPx: 9,
    bobRollDeg: 0.6,
    bobScale: 1.04,
    /** View pitch while walking (slightly down, like watching your step). */
    travelPitchDeg: -4,
    /** prefers-reduced-motion: plain cross-fade, no bob. */
    reducedFadeMs: 450,
  },
} as const;

/** Phones (coarse pointer or a narrow viewport) get the 4k files, everything else 6k. */
export function panoramaSize(opts: { coarsePointer: boolean; viewportWidth: number }): "4k" | "6k" {
  return opts.coarsePointer || opts.viewportWidth < 900 ? "4k" : "6k";
}

export function getNode(id: TourNodeId): TourNode {
  const node = TOUR_NODES.find((n) => n.id === id);
  if (!node) throw new Error(`unknown tour node ${id}`);
  return node;
}
