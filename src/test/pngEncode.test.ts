// @vitest-environment node
import { describe, it, expect } from "vitest";
import { encodePng } from "../../supabase/functions/meta-webhook/pngEncode";
import { decodePng } from "../../supabase/functions/meta-webhook/pngDecode";

describe("encodePng", () => {
  it("round-trips RGBA through our decoder", async () => {
    const w = 37, h = 11;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
    const png = await encodePng({ width: w, height: h, data });
    const back = await decodePng(png);
    expect([back.width, back.height]).toEqual([w, h]);
    expect(Array.from(back.data)).toEqual(Array.from(data));
  });
});
