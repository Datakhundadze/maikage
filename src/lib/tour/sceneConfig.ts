// Virtual showroom scene: a box room built from photos of the shop, walked in
// first person.
//
// Only imported from the lazy /showroom tree (ShowroomPage → PhotoRoomViewer),
// so nothing here reaches the main bundle.
//
// COORDINATES are metres. +y is up, the floor is y = 0. The room is a box
//   x: 0 at the clock wall … room.length (10) at the back wall
//   z: 0 at the street window wall … room.width (8) at the counter wall
// three.js camera convention: yaw 0 looks toward −z, positive yaw turns left
// (counter-clockwise seen from above), so yaw −90° looks toward +x, into the
// shop from the entrance. Positive pitch looks up.
//
// PHOTOS live in public/tour/room/ (WebP, ≤ 2048 px, EXIF stripped). Every
// photo panel shows a rectangular CROP of one photo: [u0, v0, u1, v1] as
// fractions of the image width/height, measured from the top-left corner.
// A panel's shape need not match its crop exactly; keep the stretch (panel
// aspect ÷ crop aspect) roughly within 0.75–1.4 (sceneConfig.test.ts checks).
//
// WALL PANELS are placed by where the crop's LEFT and RIGHT edges land on the
// wall, as seen from inside the room, in the wall's own coordinate:
//   clock wall (x = 0) and back wall (x = length): z
//   street wall (z = 0) and counter wall (z = width): x
// so `left > right` simply means the image runs toward smaller coordinates.
// Parts of a wall without a panel show the plain wall colour.
//
// RACKS are vertical photo billboards standing on the floor. `x`, `z` is the
// centre of the rack's footprint, `rotYDeg` turns it: 0 → its front faces +z,
// 90 → +x, −90 → −x, 180 → −z. The rack's axis (its `length`) runs along the
// viewer's left–right when facing the front; `depth` is front-to-back. Each
// panel sits on the axis at `offset` metres from the centre (+ = toward the
// viewer's right when facing the front) and is drawn on both sides (the back
// is not mirrored). Every rack also gets an invisible pick volume
// (length × depth × height) for hover/tap and blocks walking (see BOUNDS).
//
// BOUNDS: the walkable area is the room inset by `bounds.wallMargin`, minus
// every rack footprint grown by `bounds.rackMargin` (roomGeometry.ts builds
// it; walkBounds.ts clamps each step to it).
//
// FEEL: `bob` (head bob, walkBob.ts), `footsteps` (sound, footsteps.ts) and
// `steering` (joystick / A-D turning, walkMotion.ts) are tunable here.

import type { BobConfig } from "@/lib/tour/walkBob";
import type { FootstepConfig } from "@/lib/tour/footsteps";
import type { SteeringConfig } from "@/lib/tour/walkMotion";

/** Folder (under public/) holding the room photos. */
export const ROOM_IMAGE_BASE = "/tour/room/";

/** Pixel sizes of the photos in public/tour/room (from asset-manifest.json). */
export const ROOM_IMAGES = {
  "01-rack-long-yellow-hoodies.webp": { width: 1536, height: 2048 },
  "02-rack-gildan-white-adult-kids.webp": { width: 1536, height: 2048 },
  "03-rack-sols-white.webp": { width: 1536, height: 2048 },
  "04-clock-wall-wide-with-rack-B.webp": { width: 2048, height: 1536 },
  "05-sofa-phones-table-closeup.webp": { width: 1536, height: 2048 },
  "06-counter-wall-front-view.webp": { width: 1536, height: 2048 },
  "07-aisle-street-window-rack-C-and-D.webp": { width: 1536, height: 2048 },
  "08-aisle-hoodies-to-radio-cabinet.webp": { width: 1536, height: 2048 },
  "09-aisle-jerseys-and-polo-to-counter.webp": { width: 1536, height: 2048 },
  "10-entrance-door-with-rack-A.webp": { width: 2048, height: 1536 },
  "11-street-window-head-stands.webp": { width: 2048, height: 1536 },
  "12-street-wall-mannequins.webp": { width: 2048, height: 1536 },
  "13-back-wall-maisuri-hoodie-panel.webp": { width: 2048, height: 1536 },
  "14-radio-cabinet-oil-lamps.webp": { width: 2048, height: 1536 },
  "15-clock-wall-straight-on.webp": { width: 2048, height: 1536 },
  "16-counter-wall-straight-on.webp": { width: 2048, height: 1536 },
} as const;

export type RoomImage = keyof typeof ROOM_IMAGES;

/** [u0, v0, u1, v1]: fractions of the image, from its top-left corner. */
export type Crop = [number, number, number, number];

export type WallId = "clock" | "street" | "counter" | "back";

export interface WallPanel {
  wall: WallId;
  image: RoomImage;
  crop: Crop;
  /** Wall coordinate of the crop's left / right edge, seen from inside. */
  left: number;
  right: number;
  /** Height of the panel's bottom / top edge, metres. */
  bottom: number;
  top: number;
}

export interface RackPanel {
  image: RoomImage;
  crop: Crop;
  /** Centre along the rack axis, metres from the rack centre (+ = viewer's right). */
  offset: number;
  width: number;
  bottom: number;
  top: number;
}

export type RackId =
  | "rack_long_yellow"
  | "rack_gildan_white"
  | "rack_sols"
  | "rack_window_heads"
  | "rack_C"
  | "rack_A_D"
  | "rack_B"
  | "rack_hoodie_panel"
  | "rack_polo"
  | "rack_jerseys";

export interface Rack {
  id: RackId;
  /** Georgian name (aria label now, card title in phase 2). */
  labelKa: string;
  /** What hangs there (for phase 2's product cards). */
  models: string[];
  x: number;
  z: number;
  rotYDeg: number;
  /** Footprint along the axis / front-to-back, and pick-volume height, metres. */
  length: number;
  depth: number;
  height: number;
  panels: RackPanel[];
}

export interface ScenePose {
  x: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface SceneConfig {
  room: {
    /** Clock wall → back wall (x), metres. */
    length: number;
    /** Street wall → counter wall (z), metres. */
    width: number;
    height: number;
    wallColor: string;
    ceilingColor: string;
    /** Emissive ceiling spots: [x, z] centres, radius in metres. */
    spots: Array<[number, number]>;
    spotRadius: number;
  };
  /** Floor tiles, generated in code (floorTexture.ts). */
  floor: {
    tileSize: number;
    color: string;
    groutColor: string;
    /** Grout line width, metres. */
    groutWidth: number;
    /** Per-pixel noise, ± 0…255 levels. */
    noise: number;
  };
  walls: WallPanel[];
  racks: Rack[];
  bounds: {
    /** Clearance kept from every wall, metres. */
    wallMargin: number;
    /** Clearance kept around every rack footprint, metres. */
    rackMargin: number;
  };
  /** Camera height above the floor, metres. */
  eyeHeight: number;
  start: ScenePose;
  /** Top walking speed, m/s. */
  walkSpeed: number;
  /** Seconds to reach full speed from rest (and to stop again). */
  accelTime: number;
  /** Look up/down limit, degrees either way. */
  pitchLimitDeg: number;
  /** Turning: joystick X axis and A/D, ←/→. */
  steering: SteeringConfig;
  /** Head bob while walking (visual only; off with reduced motion). */
  bob: BobConfig;
  /** Footstep sound (off until the visitor turns it on). */
  footsteps: FootstepConfig;
  /** Phones and low-end devices. */
  lowEnd: {
    /** Pixel-ratio cap (the general cap is 2). */
    maxDpr: number;
    /** Photos are downscaled so their longest side is at most this, px. */
    maxTextureSize: number;
  };
}

export const SCENE: SceneConfig = {
  room: {
    length: 10,
    width: 8,
    height: 4,
    wallColor: "#d9ccb2",
    ceilingColor: "#f1eee6",
    spots: [
      [2, 2], [2, 6], [5, 2], [5, 6], [8, 2], [8, 6],
    ],
    spotRadius: 0.11,
  },
  floor: {
    tileSize: 0.6,
    color: "#d8d1c2",
    groutColor: "#bab2a2",
    groutWidth: 0.006,
    noise: 5,
  },
  walls: [
    // Clock wall (x = 0), seen facing −x: left is the counter side (+z).
    // 15 is used as is (whole frame, minus some ceiling), aspect kept.
    { wall: "clock", image: "15-clock-wall-straight-on.webp", crop: [0, 0.08, 1, 1], left: 5.8, right: 0, bottom: 0, top: 4 },
    // Street wall (z = 0), seen facing −z: left is the clock wall (x = 0).
    // Entrance door (red/white glass) from 10, door leaf at x ≈ 1.1–1.9.
    { wall: "street", image: "10-entrance-door-with-rack-A.webp", crop: [0.42, 0, 0.72, 0.86], left: 0.9, right: 2.76, bottom: 0, top: 4 },
    { wall: "street", image: "11-street-window-head-stands.webp", crop: [0, 0, 0.8, 1], left: 2.76, right: 7.03, bottom: 0, top: 4 },
    { wall: "street", image: "12-street-wall-mannequins.webp", crop: [0.2, 0.04, 0.76, 1], left: 7.03, right: 10, bottom: 0, top: 4 },
    // Counter wall (z = 8), seen facing +z: left is the back wall (x = 10).
    { wall: "counter", image: "16-counter-wall-straight-on.webp", crop: [0.06, 0.08, 1, 1], left: 5.45, right: 0, bottom: 0, top: 4 },
    { wall: "counter", image: "14-radio-cabinet-oil-lamps.webp", crop: [0.2, 0.08, 1, 1], left: 10, right: 5.45, bottom: 0, top: 4 },
    // Back wall (x = 10), seen facing +x: left is the street side (z = 0),
    // where the red fitting-room curtains are.
    { wall: "back", image: "13-back-wall-maisuri-hoodie-panel.webp", crop: [0.12, 0.08, 1, 1], left: 0, right: 5.6, bottom: 0, top: 4 },
  ],
  racks: [
    {
      id: "rack_long_yellow",
      labelKa: "გრძელი ყვითელი საკიდი — ჰუდები და სვიტშოტები",
      models: ["hoodies", "sweatshirts"],
      x: 6.8, z: 4.0, rotYDeg: 180,
      length: 2.0, depth: 0.6, height: 1.9,
      panels: [{ image: "01-rack-long-yellow-hoodies.webp", crop: [0.18, 0.22, 1, 1], offset: 0, width: 1.8, bottom: 0, top: 1.9 }],
    },
    {
      id: "rack_gildan_white",
      labelKa: "GILDAN თეთრი მაისურები — დიდების და ბავშვის",
      models: ["GILDAN T-shirt", "GILDAN KIDS T-shirt"],
      x: 4.0, z: 3.2, rotYDeg: -90,
      length: 1.4, depth: 0.5, height: 1.8,
      panels: [{ image: "02-rack-gildan-white-adult-kids.webp", crop: [0.1, 0.32, 0.98, 1], offset: 0, width: 1.4, bottom: 0, top: 1.6 }],
    },
    {
      id: "rack_sols",
      labelKa: "SOL'S თეთრი მაისური",
      models: ["SOL'S T-shirt"],
      x: 3.5, z: 4.6, rotYDeg: -90,
      length: 1.3, depth: 0.5, height: 1.85,
      panels: [{ image: "03-rack-sols-white.webp", crop: [0.15, 0.2, 0.92, 1], offset: 0, width: 1.3, bottom: 0, top: 1.85 }],
    },
    {
      id: "rack_window_heads",
      labelKa: "მანეკენის თავები ვიტრინასთან",
      models: ["washed T-shirt", "oversize T-shirt"],
      x: 3.4, z: 0.6, rotYDeg: 0,
      length: 2.0, depth: 0.4, height: 1.9,
      panels: [{ image: "11-street-window-head-stands.webp", crop: [0.12, 0.34, 0.82, 1], offset: 0, width: 2.2, bottom: 0, top: 1.75 }],
    },
    {
      id: "rack_C",
      labelKa: "C საკიდი ვიტრინის გასწვრივ",
      models: ["washed T-shirt", "oversize T-shirt", "GIORDANO T-shirt", "GILDAN HAMMER T-shirt"],
      x: 6.0, z: 0.8, rotYDeg: 0,
      length: 2.0, depth: 0.4, height: 1.9,
      panels: [{ image: "07-aisle-street-window-rack-C-and-D.webp", crop: [0, 0.36, 0.42, 1], offset: 0, width: 1.15, bottom: 0, top: 1.8 }],
    },
    {
      id: "rack_A_D",
      labelKa: "ფერადი მაისურების გრძელი საკიდი",
      models: ["GILDAN T-shirt"],
      // faces the window aisle (−z); viewer's right is the clock-wall side
      x: 4.5, z: 2.4, rotYDeg: 180,
      length: 4.6, depth: 0.4, height: 1.9,
      panels: [
        { image: "10-entrance-door-with-rack-A.webp", crop: [0.58, 0.55, 1, 1], offset: 1.25, width: 2.0, bottom: 0, top: 1.6 },
        { image: "07-aisle-street-window-rack-C-and-D.webp", crop: [0.56, 0.4, 1, 1], offset: -1.2, width: 1.3, bottom: 0, top: 1.8 },
      ],
    },
    {
      id: "rack_B",
      labelKa: "B საკიდი დივანთან",
      models: ["SOL'S T-shirt"],
      x: 1.6, z: 3.6, rotYDeg: 180,
      length: 1.0, depth: 0.4, height: 1.85,
      panels: [{ image: "04-clock-wall-wide-with-rack-B.webp", crop: [0.66, 0.6, 1, 1], offset: 0, width: 1.3, bottom: 0.6, top: 1.85 }],
    },
    {
      id: "rack_hoodie_panel",
      labelKa: "ჰუდების ხის კედელი",
      models: ["GILDAN hoodie", "JEL hoodie", "other hoodies"],
      // faces the shop (−x); viewer's right is the counter side (+z)
      x: 9.15, z: 4.0, rotYDeg: -90,
      length: 4.0, depth: 0.4, height: 2.2,
      panels: [
        { image: "13-back-wall-maisuri-hoodie-panel.webp", crop: [0.33, 0.38, 1, 1], offset: -0.55, width: 2.9, bottom: 0, top: 2.0 },
        { image: "08-aisle-hoodies-to-radio-cabinet.webp", crop: [0, 0.18, 0.44, 1], offset: 1.35, width: 0.8, bottom: 0, top: 2.0 },
      ],
    },
    {
      id: "rack_polo",
      labelKa: "პოლოები და მაისურები ხის საკიდებზე",
      models: ["polo"],
      x: 5.0, z: 6.1, rotYDeg: 90,
      length: 1.2, depth: 0.4, height: 1.85,
      panels: [{ image: "09-aisle-jerseys-and-polo-to-counter.webp", crop: [0.62, 0.42, 1, 1], offset: 0, width: 1.0, bottom: 0, top: 1.7 }],
    },
    {
      id: "rack_jerseys",
      labelKa: "საფეხბურთო მაისურები",
      models: ["football jerseys (test only)"],
      x: 6.6, z: 5.9, rotYDeg: -90,
      length: 1.2, depth: 0.4, height: 1.9,
      panels: [{ image: "09-aisle-jerseys-and-polo-to-counter.webp", crop: [0, 0.35, 0.44, 1], offset: 0, width: 1.1, bottom: 0, top: 1.8 }],
    },
  ],
  bounds: {
    wallMargin: 0.4,
    rackMargin: 0.35,
  },
  eyeHeight: 1.6,
  // just inside the entrance, facing +x into the shop
  start: { x: 1.5, z: 1.2, yawDeg: -90, pitchDeg: -3 },
  walkSpeed: 1.2,
  accelTime: 0.25,
  pitchLimitDeg: 60,
  steering: {
    maxTurnRateDeg: 90,
    deadZone: 0.12,
    turnSmoothTime: 0.12,
  },
  bob: {
    stepLength: 0.7,
    verticalAmp: 0.03,
    lateralAmp: 0.015,
    rollDeg: 0.4,
    settleTime: 0.2,
  },
  footsteps: {
    volume: 0.18,
    pitchHz: 70,
    pitchSpread: 0.08,
  },
  lowEnd: {
    maxDpr: 1.5,
    maxTextureSize: 1024,
  },
};
