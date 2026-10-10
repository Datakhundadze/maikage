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
// HOW THE NUMBERS FOR corner.spz WERE FOUND (453 037 splats, SPZ v3)
//   - up axis: an opacity-weighted height histogram has one dense slab at
//     y ≈ −0.1 with nothing below it and content fading out by ~2.3 m (no
//     ceiling in the scan) → +y is up, no orientation fix needed. Rendered
//     upright and not mirrored (the back wall reads map → portrait →
//     chalkboard → red board → blue door, as in the shop).
//   - floorY: the mode of that slab at 1 cm resolution.
//   - walkable: 10 cm grid of the floor plane; a cell is walkable when its
//     floor (|y − floorY| < 6 cm) is well covered and nothing dense stands
//     between 0.2 m and 1.8 m (walls, furniture). Gaps up to 0.5 m closed,
//     spurs under 0.2 m removed, shrunk by a 0.2 m margin, outline traced
//     and simplified (0.18 m tolerance); every 5 cm sample inside the
//     polygon lies on walkable floor. The unscanned patch in the middle of
//     the floor (no splats at all) and the furniture are left out, which is
//     why the area is a C-shape rather than a rectangle.
//   - start: inside the polygon, ≥ 0.5 m from its edges, facing the colourful
//     clock wall, the blue door and the brown couch.

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
}

export const SCENE: SceneConfig = {
  url: "/tour/corner.spz",
  orientationDeg: { x: 0, y: 0, z: 0 },
  floorY: -0.095,
  eyeHeight: 1.6,
  start: { x: 2.0, z: 1.0, yawDeg: 10, pitchDeg: -8 },
  walkable: [
    [4.25, -2.65], [4.55, -2.35], [4.85, -2.55], [4.65, -2.15], [4.95, -1.75], [4.65, -1.45],
    [5.95, 0.25], [3.35, 2.25], [2.65, 3.25], [2.75, 1.95], [2.45, 1.65], [1.95, 1.75],
    [1.05, 0.75], [1.25, -0.05], [0.75, -0.55], [0.35, -0.35], [0.05, -0.55], [0.45, -0.75],
    [0.85, -0.55], [1.15, -0.85], [1.15, -0.65], [2.05, 0.25], [3.85, -0.05], [2.65, 0.85],
    [3.65, 1.85], [4.05, 1.15], [5.25, 0.45], [5.15, -0.45], [4.85, -0.75], [4.55, -0.55],
    [4.55, -1.15], [4.15, -1.55], [3.35, -1.45], [2.45, -2.25], [2.95, -2.25], [3.35, -1.85],
  ],
  walkSpeed: 1.2,
  accelTime: 0.25,
  pitchLimitDeg: 60,
};
