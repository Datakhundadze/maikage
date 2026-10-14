// Pure geometry for the photo room (no three.js): where wall and rack photo
// panels go, which part of each photo they show, and the walkable area.
// The viewer turns these numbers into meshes; tests check them directly.
//
// See sceneConfig.ts for the coordinate system and the panel conventions.

import type { Vec2, WalkArea } from "@/lib/tour/walkBounds";
import { ROOM_IMAGES, type Crop, type Rack, type RackPanel, type SceneConfig, type WallId, type WallPanel } from "@/lib/tour/sceneConfig";

export type Vec3 = [number, number, number];

/** A textured rectangle: its four corners and the matching texture coordinates. */
export interface Quad {
  /** Corners as seen from the front: top-left, top-right, bottom-left, bottom-right. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** UVs for the same corners (three.js: v = 0 at the bottom of the image). */
  uvs: [Vec2, Vec2, Vec2, Vec2];
}

type Room = SceneConfig["room"];

const DEG = Math.PI / 180;

/** UVs for a crop (top-left origin fractions) with three.js's flipped v. */
export function cropUvs([u0, v0, u1, v1]: Crop): Quad["uvs"] {
  return [
    [u0, 1 - v0],
    [u1, 1 - v0],
    [u0, 1 - v1],
    [u1, 1 - v1],
  ];
}

/** Width ÷ height of a crop, in pixels. */
export function cropAspect(image: keyof typeof ROOM_IMAGES, [u0, v0, u1, v1]: Crop): number {
  const { width, height } = ROOM_IMAGES[image];
  return ((u1 - u0) * width) / ((v1 - v0) * height);
}

/** How much a panel stretches its crop horizontally (1 = undistorted). */
export function panelStretch(image: keyof typeof ROOM_IMAGES, crop: Crop, width: number, height: number): number {
  return width / height / cropAspect(image, crop);
}

/** Point on a wall's plane at wall coordinate `s`, height `y`, pulled `inset` metres into the room. */
export function wallPoint(wall: WallId, s: number, y: number, room: Room, inset = 0): Vec3 {
  switch (wall) {
    case "clock":
      return [inset, y, s];
    case "back":
      return [room.length - inset, y, s];
    case "street":
      return [s, y, inset];
    case "counter":
      return [s, y, room.width - inset];
  }
}

/** Unit normal of a wall, pointing into the room (x, z). */
export function wallNormal(wall: WallId): Vec2 {
  switch (wall) {
    case "clock":
      return [1, 0];
    case "back":
      return [-1, 0];
    case "street":
      return [0, 1];
    case "counter":
      return [0, -1];
  }
}

/** Quad of a wall photo panel, 1 cm in front of the wall. */
export function wallPanelQuad(p: WallPanel, room: Room, inset = 0.01): Quad {
  return {
    corners: [
      wallPoint(p.wall, p.left, p.top, room, inset),
      wallPoint(p.wall, p.right, p.top, room, inset),
      wallPoint(p.wall, p.left, p.bottom, room, inset),
      wallPoint(p.wall, p.right, p.bottom, room, inset),
    ],
    uvs: cropUvs(p.crop),
  };
}

/** A rack's axis (viewer's right when facing the front) and front normal, (x, z). */
export function rackFrame(rack: Pick<Rack, "rotYDeg">): { axis: Vec2; normal: Vec2 } {
  const r = rack.rotYDeg * DEG;
  // rotation about +y: local +x → (cos r, −sin r), local +z → (sin r, cos r)
  return { axis: [Math.cos(r), -Math.sin(r)], normal: [Math.sin(r), Math.cos(r)] };
}

/**
 * Front and back quads of one rack panel. The back is the same image seen
 * from behind, NOT mirrored (its left/right are swapped), pushed `gap` metres
 * behind the front so the two never fight for the same pixels.
 */
export function rackPanelQuads(rack: Rack, p: RackPanel, gap = 0.004): { front: Quad; back: Quad } {
  const { axis, normal } = rackFrame(rack);
  const at = (along: number, y: number, push: number): Vec3 => [
    rack.x + axis[0] * along + normal[0] * push,
    y,
    rack.z + axis[1] * along + normal[1] * push,
  ];
  const l = p.offset - p.width / 2;
  const r = p.offset + p.width / 2;
  const uvs = cropUvs(p.crop);
  return {
    front: { corners: [at(l, p.top, gap / 2), at(r, p.top, gap / 2), at(l, p.bottom, gap / 2), at(r, p.bottom, gap / 2)], uvs },
    back: { corners: [at(r, p.top, -gap / 2), at(l, p.top, -gap / 2), at(r, p.bottom, -gap / 2), at(l, p.bottom, -gap / 2)], uvs },
  };
}

/** Rack footprint on the floor (x, z), grown by `margin` on every side (corners in order). */
export function rackFootprint(rack: Rack, margin = 0): Vec2[] {
  const { axis, normal } = rackFrame(rack);
  const a = rack.length / 2 + margin;
  const d = rack.depth / 2 + margin;
  const pt = (sa: number, sd: number): Vec2 => [
    rack.x + axis[0] * a * sa + normal[0] * d * sd,
    rack.z + axis[1] * a * sa + normal[1] * d * sd,
  ];
  return [pt(-1, -1), pt(1, -1), pt(1, 1), pt(-1, 1)];
}

/** Walkable floor: the room inset from the walls, minus every rack with its margin. */
export function buildWalkArea(scene: Pick<SceneConfig, "room" | "racks" | "bounds">): WalkArea {
  const { length, width } = scene.room;
  const m = scene.bounds.wallMargin;
  return {
    outer: [
      [m, m],
      [length - m, m],
      [length - m, width - m],
      [m, width - m],
    ],
    holes: scene.racks.map((r) => rackFootprint(r, scene.bounds.rackMargin)),
  };
}

/** All photo files the scene shows (each loaded once). */
export function usedImages(scene: Pick<SceneConfig, "walls" | "racks">): Array<keyof typeof ROOM_IMAGES> {
  const set = new Set<keyof typeof ROOM_IMAGES>();
  for (const w of scene.walls) set.add(w.image);
  for (const r of scene.racks) for (const p of r.panels) set.add(p.image);
  return [...set].sort();
}
