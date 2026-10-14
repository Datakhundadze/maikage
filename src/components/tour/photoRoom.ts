import * as THREE from "three";
import { SCENE, ROOM_IMAGE_BASE, type RackId, type RoomImage, type SceneConfig } from "@/lib/tour/sceneConfig";
import { rackPanelQuads, wallPanelQuad, type Quad } from "@/lib/tour/roomGeometry";
import { generateFloorTexture } from "@/lib/tour/floorTexture";

// three.js side of the photo room: loads the photos and builds the meshes
// from the numbers in sceneConfig.ts / roomGeometry.ts. Imported only by
// PhotoRoomViewer (lazy /showroom chunk).
//
// Everything is unlit (MeshBasicMaterial): the photos already carry the
// shop's light, so a lighting model would only fight it.

const DEG = Math.PI / 180;
const FLOOR_TEX_PX = 1024;
const FLOOR_TEX_TILES = 4;
const HIGHLIGHT = "#fbbf24";

/**
 * Loads every photo as a texture, downscaled so the longest side is at most
 * `maxSize` px. `onProgress(done, total)` after each file. Rejects on the
 * first failure.
 */
export async function loadRoomTextures(
  files: RoomImage[],
  maxSize: number,
  anisotropy: number,
  onProgress: (done: number, total: number) => void,
): Promise<Map<RoomImage, THREE.Texture>> {
  let done = 0;
  onProgress(0, files.length);
  const entries = await Promise.all(
    files.map(async (file) => {
      const img = new Image();
      img.decoding = "async";
      img.src = ROOM_IMAGE_BASE + file;
      await img.decode();
      let source: HTMLImageElement | HTMLCanvasElement = img;
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      if (longest > maxSize) {
        const k = maxSize / longest;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * k);
        canvas.height = Math.round(img.naturalHeight * k);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          source = canvas;
        }
      }
      const tex = new THREE.Texture(source);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = anisotropy;
      tex.needsUpdate = true;
      onProgress(++done, files.length);
      return [file, tex] as const;
    }),
  );
  return new Map(entries);
}

function quadGeometry(q: Quad): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(q.corners.flat(), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(q.uvs.flat(), 2));
  // TL, TR, BL, BR → counter-clockwise from the front
  g.setIndex([0, 2, 3, 0, 3, 1]);
  return g;
}

function floorTexture(scene: SceneConfig, anisotropy: number): THREE.DataTexture {
  const f = scene.floor;
  const data = generateFloorTexture({
    size: FLOOR_TEX_PX,
    tiles: FLOOR_TEX_TILES,
    color: f.color,
    groutColor: f.groutColor,
    groutFraction: f.groutWidth / f.tileSize,
    noise: f.noise,
  });
  const tex = new THREE.DataTexture(data, FLOOR_TEX_PX, FLOOR_TEX_PX, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  const span = f.tileSize * FLOOR_TEX_TILES;
  tex.repeat.set(scene.room.length / span, scene.room.width / span);
  tex.needsUpdate = true;
  return tex;
}

export interface PhotoRoom {
  group: THREE.Group;
  /** Invisible rack volumes for raycasting; `userData.rackId` names the rack. */
  pickables: THREE.Object3D[];
  setHighlight(id: RackId | null): void;
  dispose(): void;
}

export function buildPhotoRoom(textures: Map<RoomImage, THREE.Texture>, anisotropy: number, scene: SceneConfig = SCENE): PhotoRoom {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    return d;
  };
  const { length: L, width: W, height: H } = scene.room;

  // ── shell: floor, ceiling, plain walls (seen from inside) ───────────────
  const floorTex = keep(floorTexture(scene, anisotropy));
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(L, W)), keep(new THREE.MeshBasicMaterial({ map: floorTex })));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(L / 2, 0, W / 2);
  group.add(floor);

  const ceiling = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(L, W)),
    keep(new THREE.MeshBasicMaterial({ color: scene.room.ceilingColor })),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(L / 2, H, W / 2);
  group.add(ceiling);

  const wallMat = keep(new THREE.MeshBasicMaterial({ color: scene.room.wallColor }));
  const addWall = (w: number, x: number, z: number, rotY: number) => {
    const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, H)), wallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = rotY;
    group.add(m);
  };
  addWall(W, 0, W / 2, Math.PI / 2); // clock wall, faces +x
  addWall(W, L, W / 2, -Math.PI / 2); // back wall, faces −x
  addWall(L, L / 2, 0, 0); // street wall, faces +z
  addWall(L, L / 2, W, Math.PI); // counter wall, faces −z

  // ceiling spots: a bright disc with a faint warm halo
  const spotGeo = keep(new THREE.CircleGeometry(scene.room.spotRadius, 24));
  const haloGeo = keep(new THREE.RingGeometry(scene.room.spotRadius, scene.room.spotRadius * 3.2, 32));
  const spotMat = keep(new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  const haloMat = keep(
    new THREE.MeshBasicMaterial({ color: "#fff3d6", transparent: true, opacity: 0.35, depthWrite: false }),
  );
  for (const [x, z] of scene.room.spots) {
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.rotation.x = Math.PI / 2;
    spot.position.set(x, H - 0.004, z);
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(x, H - 0.003, z);
    group.add(spot, halo);
  }

  // ── photo panels ────────────────────────────────────────────────────────
  const photoMats = new Map<RoomImage, THREE.MeshBasicMaterial>();
  const photoMat = (image: RoomImage) => {
    let m = photoMats.get(image);
    if (!m) {
      m = keep(new THREE.MeshBasicMaterial({ map: textures.get(image) ?? null }));
      photoMats.set(image, m);
    }
    return m;
  };
  for (const p of scene.walls) {
    group.add(new THREE.Mesh(keep(quadGeometry(wallPanelQuad(p, scene.room))), photoMat(p.image)));
  }

  // ── racks: billboards, floor shadow, pick volume, highlight outline ─────
  const pickables: THREE.Object3D[] = [];
  const outlines = new Map<RackId, { outline: THREE.LineSegments; shadow: THREE.MeshBasicMaterial }>();
  const pickMat = keep(new THREE.MeshBasicMaterial());
  const outlineMat = keep(new THREE.LineBasicMaterial({ color: HIGHLIGHT }));
  for (const rack of scene.racks) {
    for (const p of rack.panels) {
      const { front, back } = rackPanelQuads(rack, p);
      group.add(new THREE.Mesh(keep(quadGeometry(front)), photoMat(p.image)));
      group.add(new THREE.Mesh(keep(quadGeometry(back)), photoMat(p.image)));
    }

    const frame = new THREE.Group();
    frame.position.set(rack.x, 0, rack.z);
    frame.rotation.y = rack.rotYDeg * DEG;
    group.add(frame);

    const shadowMat = keep(
      new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.16, depthWrite: false }),
    );
    const shadow = new THREE.Mesh(keep(new THREE.PlaneGeometry(rack.length + 0.1, rack.depth + 0.1)), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    frame.add(shadow);

    const box = keep(new THREE.BoxGeometry(rack.length, rack.height, rack.depth));
    const pick = new THREE.Mesh(box, pickMat);
    pick.visible = false; // raycast only
    pick.position.y = rack.height / 2;
    pick.userData.rackId = rack.id;
    pick.name = rack.id;
    frame.add(pick);
    pickables.push(pick);

    const outline = new THREE.LineSegments(keep(new THREE.EdgesGeometry(box)), outlineMat);
    outline.position.y = rack.height / 2;
    outline.visible = false;
    frame.add(outline);
    outlines.set(rack.id, { outline, shadow: shadowMat });
  }
  group.updateMatrixWorld(true);

  let current: RackId | null = null;
  return {
    group,
    pickables,
    setHighlight(id) {
      if (id === current) return;
      for (const [rid, o] of outlines) {
        const on = rid === id;
        o.outline.visible = on;
        o.shadow.color.set(on ? HIGHLIGHT : "#000000");
        o.shadow.opacity = on ? 0.4 : 0.16;
      }
      current = id;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      for (const t of textures.values()) t.dispose();
    },
  };
}
