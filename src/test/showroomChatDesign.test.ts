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
    expect(WIDGET.slice(at - 900, at)).toContain("onShowroom");
    expect(WIDGET).toContain('const onShowroom = location.pathname.startsWith("/showroom");');
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
    expect(body).toContain("if (!lim.allowed) {");
    expect(body).toContain('throw new Error("limit");');
    expect(body.indexOf("paid();\n            src = await extractPrintFromPhoto(src);")).toBeGreaterThan(0);
    expect(body).toContain("if (!off) announceSketch();");
  });
});

describe("optional sign-in in the showroom (2026-11-15)", () => {
  const WALK = read("../components/tour/VideoWalk.tsx");
  const DESIGNER = read("../components/tour/RackPhotoDesigner.tsx");
  it("never at the door: the window opens only from the event or the corner button", () => {
    expect(WALK).toContain("const [login, setLogin] = useState<{ message?: string } | null>(null);");
    expect(WALK.match(/setLogin\(\{/g)?.length).toBe(2); // the event listener and the button
    expect(WALK).toContain('{status === "ready" && (fullscreen || covering) && (');
  });
  it("a guest out of AI allowance in the designer is offered the sign-in window", () => {
    expect(DESIGNER).toContain('if ("reason" in lim && lim.reason === "guest_limit") askShowroomLogin(');
    expect(DESIGNER).toContain("if (err instanceof RateLimitError && err.requiresLogin) askShowroomLogin();");
  });
});

describe("everything stays in the showroom (2026-11-16)", () => {
  const WIDGET = read("../components/ChatWidget.tsx");
  const DESIGNER = read("../components/tour/RackPhotoDesigner.tsx");
  it("the garment's photo goes with a showroom message that has no attachment, and the bot's block is parsed with it", () => {
    expect(WIDGET).toContain("const sentAttachment = attachment ?? (onShowroom ? getShowroomPhoto() : null);");
    expect(WIDGET).toContain("faqChat(history, lang, sessionIdRef.current, sentAttachment ?? undefined)");
    expect(WIDGET).toContain("parseChatSuggestion(reply, !!sentAttachment)");
  });
  it("every design block is offered to the showroom, edits included; a message about the garment's own photo names no product", () => {
    expect(WIDGET).toContain('if (!autoApplied && suggestion?.kind === "mockup" && onShowroom && !suggestion.mockup.removeWhite) {');
    expect(WIDGET).toContain("brand: attachment ? mk.subProduct : sentAttachment ? undefined : mk.subProduct,");
    expect(WIDGET).toContain("...(mk.editPrompt?.trim() ? { editPrompt: mk.editPrompt.trim() } : {}),");
  });
  it("each AI step in the designer is paid from the allowance before it runs", () => {
    const at = DESIGNER.indexOf("const paid = () => {");
    const body = DESIGNER.slice(at, DESIGNER.indexOf("img = await loadImg(src);", at));
    expect(body.match(/paid\(\);/g)?.length).toBe(3); // extract, background removal, edit
    expect(body.indexOf("paid();\n            src = await editImage(")).toBeGreaterThan(0);
    expect(body).toContain('if ((await transparentShare(cutout)) < 0.02) throw new Error("nothing removed");');
  });
  it("the garment photo store", async () => {
    const m = await import("@/lib/tour/showroomChatDesign");
    m.setShowroomPhoto("data:x");
    expect(m.getShowroomPhoto()).toBe("data:x");
    m.setShowroomPhoto(null);
    expect(m.getShowroomPhoto()).toBeNull();
  });
});
