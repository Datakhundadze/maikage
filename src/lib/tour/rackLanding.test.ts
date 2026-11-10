import { describe, expect, it } from "vitest";
import { resolveBrandSlug, resolveProductSlug } from "@/lib/productSlugs";
import { rackLandingPath, showroomRackFromHash } from "./rackItem";
import { SHOWROOM_RACKS } from "./showroomRacks";

describe("rack → constructor link", () => {
  it("every rack item opens its product's landing route with the right brand, never the home page", () => {
    for (const r of SHOWROOM_RACKS) {
      if (r.items === "catalog") continue;
      for (const it of r.items) {
        const path = rackLandingPath(r.id, it);
        const m = /^\/([a-z0-9-]+)(?:\/([a-z0-9-]+))?#showroom=([a-z0-9-]+)$/.exec(path);
        expect(m, `${r.id}: ${path}`).not.toBeNull();
        const product = resolveProductSlug(m![1]);
        expect(product).toBe(it.product);
        if (m![2]) expect(resolveBrandSlug(product!, m![2])).toBe(it.brand);
        else expect(it.brand).toBe(it.product); // a product without brands
        expect(showroomRackFromHash("#" + path.split("#")[1])).toBe(r.id);
      }
    }
  });

  it("only a clean showroom hash counts", () => {
    expect(showroomRackFromHash("")).toBeNull();
    expect(showroomRackFromHash("#showroom=<script>")).toBeNull();
    expect(showroomRackFromHash("#showroom=nike")).toBe("nike");
  });
});
