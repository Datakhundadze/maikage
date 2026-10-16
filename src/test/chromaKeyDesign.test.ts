import { describe, it, expect } from "vitest";
import { keyGreenDesignPixels } from "@/lib/chromaKey";

type RGB = [number, number, number];
const GREEN: RGB = [0, 255, 0];
const WHITE: RGB = [255, 255, 255];
const ORANGE: RGB = [255, 140, 0];

/**
 * 12x12 synthetic design: green backdrop; a WHITE "letter" ring from (2,2) to
 * (9,9) two pixels thick, whose counter (4..7) is GREEN — backdrop trapped
 * inside the letter, unreachable from the frame edge. One ORANGE pixel sits on
 * the ring.
 */
function makeDesign(): { px: Uint8ClampedArray; w: number; h: number; at: (x: number, y: number) => number } {
  const w = 12;
  const h = 12;
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x: number, y: number, c: RGB) => {
    const i = (y * w + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, GREEN);
  for (let y = 2; y <= 9; y++) for (let x = 2; x <= 9; x++) {
    const inCounter = x >= 4 && x <= 7 && y >= 4 && y <= 7;
    if (!inCounter) set(x, y, WHITE);
  }
  set(2, 5, ORANGE);
  return { px, w, h, at: (x, y) => (y * w + x) * 4 };
}

describe("keyGreenDesignPixels", () => {
  it("keys the border-connected backdrop AND the green trapped inside the letter", () => {
    const { px, w, h, at } = makeDesign();
    const { borderKeyed, enclosedKeyed } = keyGreenDesignPixels(px, w, h);

    // Backdrop: 144 - 64 (8x8 letter block) = 80 border-connected pixels.
    expect(borderKeyed).toBe(80);
    // Counter: 4x4 = 16 enclosed pixels.
    expect(enclosedKeyed).toBe(16);

    expect(px[at(0, 0) + 3]).toBe(0); // corner backdrop
    expect(px[at(11, 6) + 3]).toBe(0); // edge backdrop
    expect(px[at(5, 5) + 3]).toBe(0); // inside the letter's counter
    expect(px[at(7, 4) + 3]).toBe(0);
  });

  it("keeps white and orange artwork pixels opaque and unchanged", () => {
    const { px, w, h, at } = makeDesign();
    keyGreenDesignPixels(px, w, h);

    const white = at(3, 3);
    expect([px[white], px[white + 1], px[white + 2], px[white + 3]]).toEqual([255, 255, 255, 255]);
    const orange = at(2, 5);
    expect([px[orange], px[orange + 1], px[orange + 2], px[orange + 3]]).toEqual([255, 140, 0, 255]);
  });

  it("a wrong-colour (beige) backdrop keys nothing at the border — the failure signal survives", () => {
    const w = 6;
    const h = 6;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      px[i * 4] = 230; px[i * 4 + 1] = 215; px[i * 4 + 2] = 180; px[i * 4 + 3] = 255;
    }
    const { borderKeyed, enclosedKeyed } = keyGreenDesignPixels(px, w, h);
    expect(borderKeyed).toBe(0);
    expect(enclosedKeyed).toBe(0);
  });

  it("moderately green artwork (not screen green) is never a pass-2 seed", () => {
    const w = 5;
    const h = 5;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      // white frame
      px[i * 4] = 255; px[i * 4 + 1] = 255; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255;
    }
    const mid = (2 * w + 2) * 4;
    px[mid] = 60; px[mid + 1] = 160; px[mid + 2] = 60; // leaf green
    const { borderKeyed, enclosedKeyed } = keyGreenDesignPixels(px, w, h);
    expect(borderKeyed).toBe(0);
    expect(enclosedKeyed).toBe(0);
    // Not on a cutout edge → not despilled or faded either.
    expect([px[mid], px[mid + 1], px[mid + 2], px[mid + 3]]).toEqual([60, 160, 60, 255]);
  });

  it("despills the anti-aliased rim next to the key", () => {
    const w = 6;
    const h = 1;
    const px = new Uint8ClampedArray(w * h * 4);
    const row: RGB[] = [GREEN, GREEN, [150, 230, 150], WHITE, WHITE, WHITE];
    row.forEach((c, x) => { px[x * 4] = c[0]; px[x * 4 + 1] = c[1]; px[x * 4 + 2] = c[2]; px[x * 4 + 3] = 255; });
    keyGreenDesignPixels(px, w, h);
    // (150,230,150) has greenness 80 > 60 → keyed with the backdrop it touches.
    expect(px[2 * 4 + 3]).toBe(0);
    expect([px[3 * 4], px[3 * 4 + 1], px[3 * 4 + 2], px[3 * 4 + 3]]).toEqual([255, 255, 255, 255]);
  });
});
