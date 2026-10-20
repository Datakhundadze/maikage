// Pure logic for /showroom/3d — walking freely through the Scaniverse splat
// of the shop (components/tour/SplatWalk.tsx). Units are the splat's own
// (roughly metres; floor at y = 0). Yaw 0 looks toward −z, positive turns
// right (the same as the video walk: camera.rotation.y = −yaw).

export interface WalkGrid {
  /** Cell size in splat units. */
  cell: number;
  /** x of column 0, z of row 0. */
  x0: number;
  z0: number;
  /** One string per row (z); "1" = free floor, anything else = blocked. */
  rows: string[];
}

export interface SplatWalkFeel {
  /** Walking speed at full stick, units per second. */
  speed: number;
  /** Stick deflection below this does nothing. */
  deadZone: number;
  /** Turning speed at full sideways stick, degrees per second. */
  turnDegPerSec: number;
  /** Eye height above the floor. */
  eyeHeight: number;
  /** One footstep every strideM walked; the head bobs this much (units). */
  strideM: number;
  bobM: number;
  /** Adaptive quality: below lowFps the resolution drops (down to
   *  minPixelRatio), above highFps it rises again. */
  lowFps: number;
  highFps: number;
  minPixelRatio: number;
  /** Where the visitor starts (the most open spot of the floor) and looks (toward the middle racks). */
  start: { x: number; z: number; yawDeg: number };
}

export const SPLAT_WALK = {
  url: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/showroom/splat/shop-v1.spz",
  /** Shown while loading when the server doesn't send a length. */
  approxBytes: 27_647_076,
} as const;

export const SPLAT_FEEL: SplatWalkFeel = {
  speed: 1.3,
  deadZone: 0.12,
  turnDegPerSec: 100,
  eyeHeight: 1.75,
  strideM: 0.7,
  bobM: 0.012,
  lowFps: 28,
  highFps: 50,
  minPixelRatio: 0.45,
  start: { x: 1.4, z: 4.4, yawDeg: -21 },
};

export function isFree(grid: WalkGrid, x: number, z: number): boolean {
  const col = Math.floor((x - grid.x0) / grid.cell);
  const row = Math.floor((z - grid.z0) / grid.cell);
  if (row < 0 || row >= grid.rows.length) return false;
  const r = grid.rows[row];
  if (col < 0 || col >= r.length) return false;
  return r.charCodeAt(col) === 49; // "1"
}

/** Unit vector the view looks along on the floor (x, z) for a yaw. */
export function forwardOf(yawDeg: number): { x: number; z: number } {
  const t = (yawDeg * Math.PI) / 180;
  return { x: Math.sin(t), z: -Math.cos(t) };
}

/**
 * Move by (dx, dz) without entering blocked cells: the full step if it is
 * free, otherwise slide along x or z alone, otherwise stay. Long steps are
 * cut into pieces no longer than half a cell so thin racks can't be skipped.
 */
export function moveWithCollision(
  grid: WalkGrid,
  pos: { x: number; z: number },
  dx: number,
  dz: number,
): { x: number; z: number } {
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / (grid.cell / 2)));
  let { x, z } = pos;
  const sx = dx / n;
  const sz = dz / n;
  for (let i = 0; i < n; i++) {
    if (isFree(grid, x + sx, z + sz)) {
      x += sx;
      z += sz;
    } else if (sx !== 0 && isFree(grid, x + sx, z)) {
      x += sx;
    } else if (sz !== 0 && isFree(grid, x, z + sz)) {
      z += sz;
    } else {
      break;
    }
  }
  return { x, z };
}

/** The free cell centre nearest to (x, z) — so a start point next to a rack still works. */
export function nearestFree(grid: WalkGrid, x: number, z: number): { x: number; z: number } {
  if (isFree(grid, x, z)) return { x, z };
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  grid.rows.forEach((r, row) => {
    for (let col = 0; col < r.length; col++) {
      if (r.charCodeAt(col) !== 49) continue;
      const cx = grid.x0 + (col + 0.5) * grid.cell;
      const cz = grid.z0 + (row + 0.5) * grid.cell;
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: cx, z: cz };
      }
    }
  });
  return best ?? { x, z };
}

/** Stick → speed factor in [−1, 1] after the dead zone, rescaled so the edge of the dead zone is 0. */
export function stickAxis(v: number, deadZone: number): number {
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  return (Math.sign(v) * (Math.min(1, a) - deadZone)) / (1 - deadZone);
}
