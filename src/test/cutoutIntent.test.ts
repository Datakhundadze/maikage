import { describe, it, expect } from "vitest";
import { wantsBackgroundRemoval, wantsWhiteRemoval, cutoutIntent } from "@/lib/cutoutIntent";

describe("wantsBackgroundRemoval", () => {
  it.each([
    "ფონი მოაშორე",
    "ფონის მოხსნა",
    "ფონი მოხსენი",
    "მოაშორე ფონი",
    "ფონი წაშალე",
    "ფონი მოაცილე",
    "ფონის გარეშე მინდა",
    "ფონი გამჭვირვალე გახადე",
    "ფონი მოაშორე და დამადე მაისურზე",
    "ქუდი დაადე და ფონი მოაშორე",
    "remove the background",
    "Remove background please",
    "remove bg",
    "without background",
    "no background",
    "make the background transparent",
    "transparent background",
    "remove the background but keep the white",
    "get rid of the background",
  ])("true: %s", (text) => {
    expect(wantsBackgroundRemoval(text)).toBe(true);
  });

  it.each([
    "ფონი გააფერადე",
    "დაამატე ფონი",
    "ფონი შეცვალე ლურჯით",
    "ფონი ლურჯი გახადე და კატა წაშალე",
    "მოაშორე ქუდი და ფონი დატოვე",
    "ფონი არ მოაშორო",
    "ტელეფონის ქეისზე დამადე და წარწერა წაშალე",
    "დაუმატე სათვალე",
    "add a background",
    "make the background blue",
    "don't remove the background",
    "keep the background",
    "make the background blue and remove the cat",
    "",
  ])("false: %s", (text) => {
    expect(wantsBackgroundRemoval(text)).toBe(false);
  });
});

describe("wantsWhiteRemoval", () => {
  it.each([
    "დიზაინიდან ამოიღე ყველა თეთრი ფერი",
    "თეთრი ფერი მოაშორე",
    "თეთრი მოხსენი",
    "თეთრი წაშალე",
    "თეთრი გამჭვირვალე გახადე",
    "remove the white",
    "remove all white from the design",
    "make the white transparent",
  ])("true: %s", (text) => {
    expect(wantsWhiteRemoval(text)).toBe(true);
  });

  it.each([
    "გახადე თეთრი",
    "თეთრი წარწერა დაამატე",
    "თეთრ მაისურზე დამადე",
    "თეთრი არ წაშალო",
    "make it white",
    "white t-shirt please",
    "add white text",
    "ფონი მოაშორე",
  ])("false: %s", (text) => {
    expect(wantsWhiteRemoval(text)).toBe(false);
  });
});

describe("cutoutIntent routing", () => {
  it("white only → white", () => {
    expect(cutoutIntent("დიზაინიდან ამოიღე ყველა თეთრი ფერი")).toBe("white");
  });
  it("white background → background (green key keeps white artwork)", () => {
    expect(cutoutIntent("თეთრი ფონი მოაშორე")).toBe("background");
    expect(cutoutIntent("remove the white background")).toBe("background");
  });
  it("plain edit → null (handleChatEdit unchanged)", () => {
    expect(cutoutIntent("შავი სათვალე დაადე ძაღლს")).toBeNull();
    expect(cutoutIntent("ფონი გააფერადე")).toBeNull();
  });
});
