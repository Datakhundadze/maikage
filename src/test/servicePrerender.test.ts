// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SERVICE_LINKS, SERVICE_PAGE_LIST, SERVICES_HEADING, serviceSchemas } from "@/lib/serviceCopy";
import { CATALOG_SEO } from "@/lib/pageSeo";
import { designFallbackDescription, designSeoTitle } from "@/lib/designSeo";
import { loadAppModules } from "../../scripts/lib/appModules.mjs";

// The prerender loads lib/serviceCopy.ts, pageSeo.ts and designSeo.ts through
// its own Vite loader (scripts/lib/appModules.mjs). What it gets must be
// exactly what the live pages import — same text, same prices, same JSON-LD,
// same titles.

describe("prerender's service pages / titles === live ones", () => {
  it("loadAppModules returns the same data and builders", async () => {
    const app = await loadAppModules("[test]");
    expect(app).not.toBeNull();
    expect(app!.SERVICE_PAGE_LIST).toEqual(SERVICE_PAGE_LIST);
    expect(app!.SERVICE_LINKS).toEqual(SERVICE_LINKS);
    expect(app!.SERVICES_HEADING).toBe(SERVICES_HEADING);
    for (const p of SERVICE_PAGE_LIST) expect(app!.serviceSchemas(p)).toEqual(serviceSchemas(p));
    expect(app!.CATALOG_SEO).toEqual(CATALOG_SEO);
    for (const [n, c] of [["ლატე", "წყვილები"], ["დიზაინი 1 (11)", "სხვადასხვა"], ["ფოო", null]] as const) {
      expect(app!.designSeoTitle(n, c)).toBe(designSeoTitle(n, c));
      expect(app!.designFallbackDescription(n, c, null)).toBe(designFallbackDescription(n, c, null));
    }
  }, 30_000);
});
