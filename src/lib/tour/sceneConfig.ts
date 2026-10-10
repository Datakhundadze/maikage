// Virtual showroom scene: one Gaussian-splat scan, walked in first person.
//
// Only imported from the lazy /showroom tree (ShowroomPage → SplatViewer), so
// nothing here reaches the main bundle.
//
// COORDINATES are the scan's own, in metres (Scaniverse scans are metric),
// after `orientationDeg` is applied: +y is up, the floor is the plane
// y = floorY, and the walkable area is a polygon on that plane in (x, z).
// three.js camera convention: yaw 0 looks toward −z, positive yaw turns left
// (counter-clockwise seen from above); positive pitch looks up.
//
// HOW THE NUMBERS FOR corner.spz WERE FOUND (447 231 splats, SPZ v3, SH 3)
//   - up axis: an opacity-weighted height histogram has one dense slab at
//     y ≈ −0.8 with almost nothing below it, content up to ~2.9 m above it
//     and a thin ceiling layer at 2.3–2.8 m → +y is up. A plane fit to the
//     slab is level (0.3° tilt), so no orientation fix is needed. Rendered
//     upright and not mirrored (the „ПОЧТА" mailbox and the T-shirt print
//     read left to right; clock wall, blue door and brown couch sit where
//     they are in the shop).
//   - floorY: the mode of that slab at 1 cm resolution.
//   - walkable: 10 cm grid of the floor plane; a cell is walkable when its
//     floor (|y − floorY| < 6 cm) is well covered and nothing dense stands
//     between 0.2 m and 1.8 m (walls, racks, tables). Gaps up to 0.5 m
//     closed, spurs under 0.2 m removed, shrunk by a 0.2 m margin, the part
//     around the shop's middle aisle kept, outline traced and simplified
//     (0.18 m tolerance); every 5 cm sample inside the polygon lies on
//     walkable floor. Patches with thin floor coverage are left out.
//   - start: inside the polygon, 0.74 m from its nearest edge, facing −x:
//     the colourful clock wall, the blue door and the brown couch.
//
// FEEL: `bob` (head bob, src/lib/tour/walkBob.ts) and `footsteps` (sound,
// src/lib/tour/footsteps.ts) are tunable here.

import type { BobConfig } from "@/lib/tour/walkBob";
import type { FootstepConfig } from "@/lib/tour/footsteps";

export interface ScenePose {
  x: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface SceneConfig {
  /** Splat file (.spz). Temporary copy in public/; later a storage URL. */
  url: string;
  /** Euler rotation (XYZ, degrees) applied to the splat to make +y up. */
  orientationDeg: { x: number; y: number; z: number };
  /** Floor height in scene units (metres), after orientation. */
  floorY: number;
  /** Camera height above the floor, metres. */
  eyeHeight: number;
  start: ScenePose;
  /** Walkable area on the floor plane: [x, z] vertices in order, metres. */
  walkable: Array<[number, number]>;
  /** Top walking speed, m/s. */
  walkSpeed: number;
  /** Seconds to reach full speed from rest (and to stop again). */
  accelTime: number;
  /** Look up/down limit, degrees either way. */
  pitchLimitDeg: number;
  /** Head bob while walking (visual only; off with reduced motion). */
  bob: BobConfig;
  /** Footstep sound (off until the visitor turns it on). */
  footsteps: FootstepConfig;
}

export const SCENE: SceneConfig = {
  url: "/tour/corner.spz",
  orientationDeg: { x: 0, y: 0, z: 0 },
  floorY: -0.755,
  eyeHeight: 1.6,
  start: { x: -2.2, z: 1.75, yawDeg: 90, pitchDeg: -5 },
  walkable: [
    [1.55, 0.55], [1.75, 1.45], [0.35, 1.75], [0.05, 2.05], [0.05, 3.35], [-0.25, 3.25],
    [-0.15, 2.75], [-0.95, 1.75], [-1.45, 2.05], [-1.25, 2.35], [-3.15, 2.65], [-3.65, 1.95],
    [-3.95, 2.05], [-4.45, 2.75], [-4.95, 2.95], [-4.95, 2.65], [-4.25, 2.15], [-4.35, 1.35],
    [-3.55, 1.25], [-3.25, 0.85], [-2.75, 1.15], [-2.05, 0.85], [-1.45, 1.35], [-0.75, 0.95],
    [-0.55, 1.15], [0.65, 0.95], [0.95, 1.35], [1.35, 1.35], [1.65, 1.05],
  ],
  walkSpeed: 1.2,
  accelTime: 0.25,
  pitchLimitDeg: 60,
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
};
