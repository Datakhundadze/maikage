// The chat's sketch inside the showroom (2026-11-14).
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  dropShowroomDesign, offerShowroomDesign, peekShowroomDesign, showroomDesignFits, takeShowroomDesign, SHOWROOM_DESIGN_EVENT,
} from "@/lib/tour/showroomChatDesign";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
afterEach(() => dropShowroomDesign());

describe("offer / take", () => {
  it("nobody routes it → not claimed, nothing left pending (the chat keeps its button)", () => {
    expect(offerShowroomDesign({ text: "a" })).toBe(false);
    expect(peekShowroomDesign()).toBeNull();
  });
  it("an empty design is never offered", () => {
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(SHOWROOM_DESIGN_EVENT, claim);
    expect(offerShowroomDesign({ brand: "GILDAN", text: "  " })).toBe(false);
    window.removeEventListener(SHOWROOM_DESIGN_EVENT, claim);
  });
  it("claimed → pending; only the named brand's designer takes it, once", () => {
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(SHOWROOM_DESIGN_EVENT, claim);
    expect(offerShowroomDesign({ brand: "GILDAN Hoodie", image: "data:image/png;base64,AA", extract: true })).toBe(true);
    window.removeEventListener(SHOWROOM_DESIGN_EVENT, claim);
    expect(showroomDesignFits("Oversize")).toBe(false);
    expect(takeShowroomDesign("Oversize")).toBeNull();
    expect(takeShowroomDesign("GILDAN Hoodie")).toMatchObject({ extract: true });
    expect(takeShowroomDesign("GILDAN Hoodie")).toBeNull();
  });
  it("no brand named → whatever is open takes it", () => {
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener(SHOWROOM_DESIGN_EVENT, claim);
    offerShowroomDesign({ text: "a" });
    window.removeEventListener(SHOWROOM_DESIGN_EVENT, claim);
    expect(takeShowroomDesign("Polo")).toMatchObject({ text: "a" });
  });
});

describe("wiring (source)", () => {
  const WIDGET = read("../components/ChatWidget.tsx");
  const WALK = read("../components/tour/VideoWalk.tsx");
  const DESIGNER = read("../components/tour/RackPhotoDesigner.tsx");
  it("the widget offers it only in the showroom and never navigates away from there", () => {
    const at = WIDGET.indexOf("offerShowroomDesign({");
    expect(at).toBeGreaterThan(0);
    expect(WIDGET.slice(at - 400, at)).toContain('location.pathname.startsWith("/showroom")');
    expect(WIDGET).toContain('!location.pathname.startsWith("/showroom") &&\n      seedMockupForConstructor');
  });
  it("the walk claims it only once inside, and only for a rack that has a designer", () => {
    expect(WALK).toContain('canRouteRef.current = entered && status === "ready";');
    expect(WALK).toContain("if (!d || !canRouteRef.current) return;");
    expect(WALK).toContain("!!RACK_GARMENTS[x.rack.id] && x.rack.items[0].brand === d.brand");
  });
  it("an extraction goes through the allowance; a failure is announced without a picture", () => {
    const at = DESIGNER.indexOf("const d = takeShowroomDesign(brand);");
    const body = DESIGNER.slice(at, DESIGNER.indexOf("// the picture for the chat", at));
    expect(body).toContain('if (!lim.allowed) throw new Error("limit");');
    expect(body.indexOf("recordGeneration();")).toBeLessThan(body.indexOf("extractPrintFromPhoto(d.image)"));
    expect(body).toContain("if (!off) announceSketch();");
  });
});
