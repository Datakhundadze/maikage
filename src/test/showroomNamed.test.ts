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
    expect(V).toContain("if (t >= times.cutAt) endIntro();");
    expect(V).toContain('(intro !== "done" && !introWalk)');
  });
  it("the clip starts after the parked car has left the picture", () => {
    const V = readFileSync("src/components/tour/VideoWalk.tsx", "utf8");
    expect(V).toContain("const INTRO_TIMES = { portrait: { walkAt: 1.4, cutAt: 3.7 }, landscape: { walkAt: 0.7, cutAt: 3.0 } } as const;");
    expect(V).not.toContain(".mp4#t=");
  });
  it("a showroom order's form is glass over a showroom still — look only, OrderDialog untouched", () => {
    const P = readFileSync("src/pages/SimplePage.tsx", "utf8");
    expect(P).toContain("if (seed.order || seed.tryOn) setShowroomOrder(true);");
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
  it("2026-11-23: look from the first paint, back from the bank, fitting room, admin mark", () => {
    const M = readFileSync("src/main.tsx", "utf8");
    expect(M).toContain('if (seedWantsShowroomLook()) document.documentElement.classList.add("maika-order-glass");');
    const P = readFileSync("src/pages/SimplePage.tsx", "utf8");
    expect(P).toContain("seedRef.current = consumeConstructorSeed() ?? restoreShowroomSeedOnBack();");
    expect(P).toContain("if (seed.tryOn) setPendingTryOn(true);");
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D).toContain('onClick={() => order("tryOn")}');
    expect(D).toContain("askShowroomFitting({");
    const A = readFileSync("src/lib/attribution.ts", "utf8");
    expect(A).toContain('export const SHOWROOM_ORDER_MARK = "/showroom#order";');
    const S = readFileSync("src/lib/constructorSeed.ts", "utf8");
    expect(S).toContain('export const FROM_SHOWROOM_KEY = "maika.order.fromShowroom";');
    expect(A).toContain('export const SHOWROOM_ORDER_FLAG = "maika.order.fromShowroom";');
  });
});

import { normalizeConstructorSeed } from "@/lib/constructorSeed";
import { attributionSummary } from "@/hooks/useOrderAttribution";
describe("showroom seed tryOn + admin mark (behaviour)", () => {
  it("tryOn survives normalisation only on the last seed and never with order", () => {
    const ts = Date.now();
    expect(normalizeConstructorSeed({ ts, text: "a", tryOn: true })?.tryOn).toBe(true);
    expect(normalizeConstructorSeed({ ts, text: "a", tryOn: true, order: true })?.tryOn).toBeUndefined();
    const chained = normalizeConstructorSeed({ ts, text: "a", tryOn: true, then: { ts, text: "b", tryOn: true } });
    expect(chained?.tryOn).toBeUndefined();
    expect(chained?.then?.tryOn).toBe(true);
  });
  it("an order marked /showroom#order reads as a showroom order in the admin", () => {
    const row = { order_id: "x", cart_id: null, lt_landing_page: "/showroom#order" } as never;
    const s = attributionSummary([row]);
    expect(s?.label.startsWith("შოურუმი")).toBe(true);
    expect(s?.title).toContain("ვირტუალური შოურუმიდან");
    expect(attributionSummary([{ order_id: "y", cart_id: null, lt_landing_page: "/catalog" } as never])?.label.startsWith("შოურუმი")).toBe(false);
  });
});

import { askShowroomFitting, hasRackDesign, keepRackDesign, takeRackDesign, takeShowroomFitting, FITTING_STOP, SHOWROOM_FITTING_EVENT } from "@/lib/tour/showroomFitting";
describe("the showroom's fitting room (David 2026-11-23: go to the real one, the red curtain)", () => {
  it("the request is handed over once, with an event", () => {
    let fired = 0;
    const on = () => fired++;
    window.addEventListener(SHOWROOM_FITTING_EVENT, on);
    askShowroomFitting({ rackId: "gildan", brand: "GILDAN", designImage: "d", garmentImage: "g", orderSeed: null });
    window.removeEventListener(SHOWROOM_FITTING_EVENT, on);
    expect(fired).toBe(1);
    expect(takeShowroomFitting()?.rackId).toBe("gildan");
    expect(takeShowroomFitting()).toBeNull();
  });
  it("the design left at the rack is taken back once", () => {
    expect(hasRackDesign("GILDAN")).toBe(false);
    keepRackDesign("GILDAN", { color: "Black" });
    expect(hasRackDesign("GILDAN")).toBe(true);
    expect(takeRackDesign<{ color: string }>("GILDAN")?.color).toBe("Black");
    expect(hasRackDesign("GILDAN")).toBe(false);
  });
  it("the walk stands at the NIKE end facing the curtain; the dialog is the site's own, in the showroom", () => {
    expect(FITTING_STOP.t).toBe(118.8);
    expect(FITTING_STOP.yawDeg).toBe(-108);
    expect(FITTING_STOP.pitchDeg).toBe(-16);
    const V = readFileSync("src/components/tour/VideoWalk.tsx", "utf8");
    expect(V).toContain('const TryOnModal = lazyWithRetry(() => import("@/components/TryOnModal"));');
    expect(V).toContain("if (d.fitting) setFittingOpen(true);");
    const R = readFileSync("src/components/tour/RackSheet.tsx", "utf8");
    expect(R).toContain("if (!showroomDesignFits(brand) && !hasRackDesign(brand)) return;");
  });
});

describe("from David's phone recording, 2026-11-23", () => {
  it("the try-on photo is redrawn upright before it is sent (EXIF rotation)", () => {
    const T = readFileSync("src/components/TryOnModal.tsx", "utf8");
    expect(T).toContain("void downscaleDataUrl(raw, 1600, 0.9).then((upright) => setPersonImage(upright));");
  });
  it("the designer column cannot be wider than the screen; its buttons wrap", () => {
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D).toContain('className="flex w-full max-w-[100vw] flex-col items-center overflow-hidden px-2"');
    expect(D).toContain('className="mt-3 flex max-w-full flex-wrap items-center justify-center gap-2"');
  });
});

describe("2026-11-23, second pass over David's recording", () => {
  it("the order buttons stay after the first print", () => {
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    // moving, resizing, recolouring keep them; only a new photo or new words ask for the film again
    expect(D.match(/setPrinted\(false\)/g)?.length).toBe(2);
  });
  it("the fitting dialog is placed by its left edge and capped to the screen", () => {
    const C = readFileSync("src/index.css", "utf8");
    expect(C).toContain("width: min(32rem, calc(100dvw - 24px));");
  });
});

describe("2026-11-23, David's second recording (Chrome on iPhone)", () => {
  it("no field in the showroom is under 16 px (iOS zooms the page in and stays zoomed)", () => {
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D).toContain("px-3 text-base text-white ring-1 ring-white/25 placeholder:text-white/50");
    const C = readFileSync("src/index.css", "utf8");
    expect(C).toContain(".maika-chat-panel input,");
  });
  it("the designer draws once per frame, from a light copy of the photo", () => {
    const D = readFileSync("src/components/tour/RackPhotoDesigner.tsx", "utf8");
    expect(D).toContain("if (!drawRaf.current) drawRaf.current = requestAnimationFrame(() => drawNow.current());");
    expect(D.match(/flushDraw\(\);/g)?.length).toBe(2);
    const G = readFileSync("src/lib/tour/garmentPhoto.ts", "utf8");
    expect(G).toContain("b.drawImage(previewOf(d.img), cx - w / 2, cy - ih / 2, w, ih);");
  });
});
