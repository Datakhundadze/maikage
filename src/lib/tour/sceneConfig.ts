// Virtual showroom scene: one Gaussian-splat scan, walked in first person.
//
// Only imported from the lazy /showroom tree (ShowroomPage → SplatViewer), so
// nothing here reaches the main bundle.
//
// COORDINATES are metres: the splat is scaled by `sceneScale` (the file's
// units are not metres), and every other number here is in metres after that
// scaling. +y is up, the floor is the plane y = floorY, and the walkable area
// is a polygon on that plane in (x, z). three.js camera convention: yaw 0
// looks toward −z, positive yaw turns left (counter-clockwise seen from
// above); positive pitch looks up.
//
// shop.spz: the whole shop, Polycam splat PLY converted to SPZ v2 (1 256 612
// splats, SH 0). Already up = +y, floor at y = 0, walls on the x/z axes,
// centred on the origin, cropped to the room. Facing −z from the entrance:
// the counter (green pitch panels) runs along z ≈ −1, the colourful clock
// wall with the blue door is at x ≈ +5.6, the windows and the glass entrance
// are along z ≈ +4.3, the front aisle runs along them toward −x.
//
// HOW THE NUMBERS WERE FOUND
//   - sceneScale 1.66: the file has no usable ceiling (wall content stops at
//     a crop line, y = 2.14 file units, and no height band covers more than
//     17 % of the floor), so ceiling-based scaling only gives an upper bound
//     (4 m / 2.14 = 1.87). The clock wall was cross-correlated with the same
//     wall in the earlier metric Scaniverse scan: best match at 1.63–1.68,
//     sharp peak. Cross-checks at 1.66: blue door 1.25 units → 2.08 m (≈ 2.1),
//     raised counter end 0.61 units → 1.01 m (≈ 1 m).
//   - floorY: mode of the floor slab (1 cm bins), after scaling.
//   - walkable: 10 cm grid; a cell is floor when captured floor
//     (|y − floorY| < 6 cm) lies within 0.3 m (the floor capture is patchy),
//     and walkable when nothing dense stands between 0.2 m and 1.8 m (racks,
//     tables, the counter, the sofa, walls). Gaps up to 0.3 m closed, spurs
//     removed, shrunk by a 0.2 m margin, outline traced and simplified
//     (0.08 m tolerance), sharp outward spikes (< 50°) cut off so a sliding
//     walker can't get pinned in a tip; 99.9 % of 5 cm samples inside lie on
//     walkable floor.
//     The front aisle along the windows is only 0.5–0.9 m wide between the
//     racks and the window display, so it keeps a 0.1 m margin; it joins the
//     rest through a ~0.3 m gap between a rack and the clothes rail by the
//     window (x 1.5–2.7, z ≈ 3), where the margin is waived so it stays
//     reachable.
//   - start: just inside the glass entrance, 0.38 m from the nearest edge,
//     facing into the shop.
//
// FEEL: `bob` (head bob, src/lib/tour/walkBob.ts), `footsteps` (sound,
// src/lib/tour/footsteps.ts) and `steering` (joystick / A-D turning,
// src/lib/tour/walkMotion.ts) are tunable here.

import type { BobConfig } from "@/lib/tour/walkBob";
import type { FootstepConfig } from "@/lib/tour/footsteps";
import type { SteeringConfig } from "@/lib/tour/walkMotion";

export interface ScenePose {
  x: number;
  z: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface SceneConfig {
  /** Splat file (.spz). Temporary copy in public/; later a storage URL. */
  url: string;
  /** Uniform scale applied to the splat object: file units → metres. */
  sceneScale: number;
  /** Euler rotation (XYZ, degrees) applied to the splat to make +y up. */
  orientationDeg: { x: number; y: number; z: number };
  /** Floor height in metres, after orientation and scaling. */
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
  /** Turning: joystick X axis and A/D, ←/→. */
  steering: SteeringConfig;
  /** Head bob while walking (visual only; off with reduced motion). */
  bob: BobConfig;
  /** Footstep sound (off until the visitor turns it on). */
  footsteps: FootstepConfig;
  /** Cheaper splat rendering on phones and low-end devices (Spark options). */
  lowEndRender: {
    /** Pixel-ratio cap (the general cap is 2). */
    maxDpr: number;
    /** Gaussian extent in standard deviations (Spark default √8 ≈ 2.83). */
    maxStdDev: number;
    /** Largest on-screen splat radius, px (Spark default 512). */
    maxPixelRadius: number;
    /** Minimum time between depth sorts, ms (Spark default 0). */
    minSortIntervalMs: number;
  };
}

export const SCENE: SceneConfig = {
  url: "/tour/shop.spz",
  sceneScale: 1.66,
  orientationDeg: { x: 0, y: 0, z: 0 },
  floorY: 0.005,
  eyeHeight: 1.6,
  start: { x: 3.2, z: 3.4, yawDeg: 5, pitchDeg: -5 },
  walkable: [
    [1.25, -3.95], [1.45, -3.95], [1.85, -3.65], [2.15, -3.65], [2.35, -3.45], [2.05, -3.35],
    [1.75, -3.45], [1.45, -3.15], [1.35, -2.95], [1.75, -2.45], [1.95, -2.55], [2.05, -2.45],
    [2.15, -2.55], [2.75, -2.55], [2.85, -2.45], [2.15, -2.35], [1.75, -1.85], [1.55, -1.85],
    [1.35, -2.05], [0.85, -1.55], [0.85, -1.05], [1.65, -0.05], [2.05, -0.35], [1.95, -0.65],
    [3.85, -0.55], [3.95, -0.45], [3.85, -0.25], [4.15, 0.05], [4.55, 0.05], [4.95, -0.45],
    [5.25, -0.55], [5.35, -0.45], [5.35, -0.35], [4.95, -0.25], [4.65, 0.05], [4.65, 0.45],
    [4.45, 0.85], [4.35, 0.75], [3.75, 0.75], [3.35, 1.25], [3.45, 2.05], [3.85, 2.45],
    [3.95, 2.35], [4.45, 2.45], [4.65, 2.25], [4.85, 2.25], [4.85, 2.45], [4.15, 2.85],
    [4.05, 2.75], [3.75, 3.05], [3.65, 3.25], [4.05, 3.65], [3.95, 3.85], [3.45, 3.75],
    [3.15, 3.95], [2.75, 3.45], [2.45, 3.45], [2.15, 3.15], [1.75, 3.35], [0.95, 3.25],
    [0.85, 3.45], [0.65, 3.35], [0.55, 3.45], [0.45, 3.35], [-0.55, 3.45], [-0.85, 3.05],
    [-1.05, 3.15], [-1.15, 3.05], [-1.55, 3.15], [-1.65, 3.05], [-2.25, 3.05], [-2.75, 3.05],
    [-2.85, 3.15], [-3.25, 3.05], [-3.55, 3.15], [-3.95, 3.05], [-4.05, 3.15], [-4.15, 3.05],
    [-4.65, 3.05], [-4.75, 2.95], [-4.55, 2.75], [-4.75, 2.45], [-4.55, 2.45], [-4.45, 2.55],
    [-4.55, 2.65], [-4.35, 2.85], [-3.95, 2.55], [-3.55, 2.85], [-3.25, 2.75], [-2.35, 2.85],
    [-2.05, 2.35], [-1.75, 2.45], [-1.55, 2.25], [-1.25, 2.25], [-1.05, 2.45], [-0.65, 2.55],
    [-0.45, 2.45], [0.05, 2.85], [0.55, 2.35], [0.85, 2.25], [1.05, 2.85], [1.35, 3.05],
    [2.05, 3.05], [2.15, 2.85], [2.45, 2.75], [2.65, 2.35], [2.55, 2.25], [2.75, 2.05],
    [2.45, 1.75], [2.55, 1.65], [2.45, 1.45], [2.65, 1.15], [2.55, 0.85], [2.05, 0.35],
    [1.45, 0.35], [1.35, 0.45], [1.25, 0.35], [1.05, 0.55], [0.55, 0.35], [0.35, 0.55],
    [0.15, 0.55], [-0.15, 0.45], [-0.55, -0.05], [-0.85, -0.05], [-1.15, 0.25], [-1.25, 0.15],
    [-0.95, -0.15], [-0.35, -0.15], [-0.15, -0.35], [0.25, -0.35], [0.65, -0.75], [0.75, -1.15],
    [0.65, -1.25], [0.65, -1.75], [0.35, -2.05], [-0.35, -1.55], [-0.45, -1.65], [0.05, -2.25],
    [-0.15, -2.65], [-0.45, -2.95], [-0.25, -3.05], [0.05, -2.85], [0.25, -2.95], [0.65, -2.85],
    [1.05, -3.25], [0.95, -3.65],
  ],
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
  lowEndRender: {
    maxDpr: 1.5,
    maxStdDev: 2.24,
    maxPixelRadius: 256,
    minSortIntervalMs: 33,
  },
};
