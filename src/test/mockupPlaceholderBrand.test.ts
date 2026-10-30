import { describe, it, expect } from "vitest";
import { parseMockupSuggestion } from "@/lib/mockupSuggestion";
import { parseChatSuggestion } from "@/lib/generateSuggestion";

const block = (o: Record<string, unknown>) => "პასუხი\n```maika-mockup\n" + JSON.stringify(o) + "\n```";

describe("mockup placeholders (2026-10-30 sketch audit)", () => {
  it.each(["გვარი", "სახელი", "სახელი გვარი", " გვარი ", "გვარი\n00", "სახელი გვარი\n10", "გვარი 00"])(
    "drops placeholder text %j",
    (text) => {
      expect(parseMockupSuggestion(block({ text }))?.text).toBeUndefined();
    },
  );

  it("an all-placeholder block with no photo shows nothing (block dropped)", () => {
    expect(parseChatSuggestion(block({ text: "გვარი\n00" }), false).suggestion).toBeNull();
  });

  it("keeps real names, also with a number", () => {
    expect(parseMockupSuggestion(block({ text: "ბერიძე" }))?.text).toBe("ბერიძე");
    expect(parseMockupSuggestion(block({ text: "ბერიძე\n10" }))?.text).toBe("ბერიძე\n10");
    expect(parseMockupSuggestion(block({ text: "00" }))?.text).toBe("00");
    expect(parseMockupSuggestion(block({ text: "ჩემი სახელი ნიკაა" }))?.text).toBe("ჩემი სახელი ნიკაა");
  });
});

describe("brand alias GILDAN Hammer → GILDAN HUMMER", () => {
  it.each(["GILDAN Hammer", "gildan hammer", "Hammer", "HAMMER", "GILDAN  HAMMER"])("subProduct %j", (subProduct) => {
    const m = parseMockupSuggestion(block({ text: "ნიკა", product: "T-Shirt", subProduct }));
    expect(m?.product).toBe("T-Shirt");
    expect(m?.subProduct).toBe("GILDAN HUMMER");
  });

  it("brand in the product slot", () => {
    const m = parseMockupSuggestion(block({ text: "ნიკა", product: "GILDAN Hammer" }));
    expect(m?.product).toBe("T-Shirt");
    expect(m?.subProduct).toBe("GILDAN HUMMER");
  });

  it("the catalog spelling still works and other brands are untouched", () => {
    expect(parseMockupSuggestion(block({ text: "ნიკა", subProduct: "GILDAN HUMMER" }))?.subProduct).toBe("GILDAN HUMMER");
    expect(parseMockupSuggestion(block({ text: "ნიკა", product: "T-Shirt", subProduct: "GILDAN" }))?.subProduct).toBe("GILDAN");
  });
});
