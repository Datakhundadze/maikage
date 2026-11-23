import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { namedInText } from "@/lib/tour/showroomChatDesign";
import { drawnBefore, rememberDrawn } from "@/lib/tour/showroomGenerate";

// David 2026-11-17: boiled hoodie open + "make it black and white" → the sketch
// went to a white tee; black GILDAN open → drawn on white. The bot's block
// always names a product and a colour; only the customer's own words count.
describe("what the customer named (showroom chat)", () => {
  it("black-and-white is an edit, not a garment colour", () => {
    expect(namedInText("გააშავთეთრე")).toEqual({ product: false, color: false });
    expect(namedInText("შავ-თეთრი გახადე")).toEqual({ product: false, color: false });
    expect(namedInText("make it black and white")).toEqual({ product: false, color: false });
  });
  it("a colour or a product in the customer's words is seen", () => {
    expect(namedInText("შავ მაისურზე დამიდე")).toEqual({ product: true, color: true });
    expect(namedInText("ჰუდიზე მინდა")).toEqual({ product: true, color: false });
    expect(namedInText("წითელზე როგორ იქნება?")).toEqual({ product: false, color: true });
    expect(namedInText("გააშავთეთრე და თეთრზე დადე").color).toBe(true);
    expect(namedInText("ეს წარწერა დამიდე")).toEqual({ product: false, color: false });
  });
  it("the designer repaints only for a named colour; the chat keeps the open garment otherwise", () => {
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D).toContain("if (d.colorNamed && d.color &&");
    const W = readFileSync("src/components/ChatWidget.tsx", "utf8");
    expect(W).toContain("preferOpen: !named.product,");
    expect(W.match(/colorNamed: /g)?.length).toBe(3);
  });
  it("the street clip is cut just inside the door and the walk starts under it", () => {
    const V = readFileSync("src/components/tour/VideoWalk.tsx", "utf8");
    expect(V).toContain("if (t >= INTRO_CUT_AT) endIntro();");
    expect(V).toContain('(intro !== "done" && !introWalk)');
  });
  it("the clip starts after the parked car has left the picture", () => {
    const V = readFileSync("src/components/tour/VideoWalk.tsx", "utf8");
    expect(V).toContain("const INTRO_START = { portrait: 2.0, landscape: 3.6 };");
    expect(V).toContain("onLoadedMetadata");
  });
  it("a showroom order's form is glass over a showroom still — look only, OrderDialog untouched", () => {
    const P = readFileSync("src/pages/SimplePage.tsx", "utf8");
    expect(P).toContain("if (seed.order) setShowroomOrder(true);");
    expect(P).toContain('document.documentElement.classList.add("maika-order-glass")');
    const C = readFileSync("src/index.css", "utf8");
    expect(C).toContain("html.maika-order-glass body::before");
    const O = readFileSync("src/components/OrderDialog.tsx", "utf8");
    expect(O).not.toContain("maika-order-glass");
  });
  it("the same drawing request is not generated twice (the bot re-emits the block for a colour change)", () => {
    const g = { prompt: "ლომი გვირგვინით", style: "Cartoon", withBackground: false };
    expect(drawnBefore(g)).toBeNull();
    rememberDrawn(g, "data:image/png;base64,AAA");
    expect(drawnBefore({ ...g, prompt: " ლომი გვირგვინით " })).toBe("data:image/png;base64,AAA");
    expect(drawnBefore({ ...g, style: "Anime" })).toBeNull();
    expect(drawnBefore({ ...g, prompt: "მგელი" })).toBeNull();
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D.indexOf("drawnBefore(d.generate)")).toBeLessThan(D.indexOf("recordGeneration();"));
  });
  it("KB v2.9: a photo attached + 'move it to red' is a mockup, not a re-drawn generate", () => {
    const K = readFileSync("supabase/functions/gemini-proxy/index.ts", "utf8");
    expect(K).toContain("# v2.9 (2026-11-17");
    expect(K).toContain("NEVER re-emit the earlier maika-generate here");
  });
  it("Polo: the print area is at the heart, beside the buttons (David 2026-11-23)", () => {
    const G = readFileSync("src/lib/tour/siteGarment.ts", "utf8");
    const polo = G.split("\n").find((l) => l.trim().startsWith("polo:")) ?? "";
    expect(polo).toContain("frontArea: [0.56, 0.21, 0.22, 0.19]");
    expect(polo).toContain('placement: "left-chest"');
  });
});
