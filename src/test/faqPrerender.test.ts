// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FAQ_GROUPS, FAQ_PAGE, faqPageSchema } from "@/lib/faqContent";
import { loadAppModules } from "../../scripts/lib/appModules.mjs";

// The prerender loads lib/faqContent.ts through its own Vite loader
// (scripts/lib/appModules.mjs). What it gets must be exactly what the live
// page imports — same questions, same answers, same prices, same JSON-LD.

describe("prerender's FAQ === live FAQ", () => {
  it("loadAppModules returns the same FAQ_PAGE, FAQ_GROUPS and FAQPage schema", async () => {
    const app = await loadAppModules("[test]");
    expect(app).not.toBeNull();
    expect(app!.FAQ_PAGE).toEqual(FAQ_PAGE);
    expect(app!.FAQ_GROUPS).toEqual(FAQ_GROUPS);
    expect(app!.faqPageSchema(app!.FAQ_GROUPS)).toEqual(faqPageSchema(FAQ_GROUPS));
    const answers = app!.FAQ_GROUPS.flatMap((g) => g.items.map((i) => i.a));
    for (const a of answers) {
      expect(a).not.toContain("undefined");
      expect(a).not.toContain("NaN");
    }
  }, 30_000);
});
