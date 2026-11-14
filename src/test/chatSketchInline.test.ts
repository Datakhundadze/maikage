// The sketch in the chat bubble instead of a button (2026-11-14).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { announceSketch, SKETCH_READY_EVENT } from "@/lib/constructorBridge";

const read = (p: string) => readFileSync(path.resolve(__dirname, p), "utf8");
const PAGE = read("../pages/SimplePage.tsx");
const WIDGET = read("../components/ChatWidget.tsx");
const CHATPAGE = read("../pages/ChatPage.tsx");

describe("announceSketch", () => {
  it("carries the picture; without one the detail has no image (the chat then says it failed)", () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(SKETCH_READY_EVENT, on);
    announceSketch("data:image/jpeg;base64,AA");
    announceSketch();
    window.removeEventListener(SKETCH_READY_EVENT, on);
    expect(seen).toEqual([{ image: "data:image/jpeg;base64,AA" }, {}]);
  });
  it("never throws when nobody listens", () => {
    const spy = vi.spyOn(window, "dispatchEvent").mockImplementation(() => { throw new Error("x"); });
    expect(() => announceSketch("a")).not.toThrow();
    spy.mockRestore();
  });
});

describe("constructor (source)", () => {
  const start = PAGE.indexOf("// ── The sketch, back to the chat (add-only, 2026-11-14)");
  const body = PAGE.slice(start, PAGE.indexOf("// ── Chained seed: the showroom's second side", start));
  it("photographs with compositeSide, after every seeded AI step, and reports a failed extraction without a picture", () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain("void compositeSide(sideData, currentView)");
    expect(body).toContain('if (pendingShot.extract && extractResultRef.current === "failed") return give();');
    expect(body).toContain("!!pendingExtract || !!pendingRemoveBg || !!pendingEdit ||");
    expect(body).not.toContain("setOrderDialogOpen");
  });
  it("only a plain design seed is photographed — not an order, a chain or a generation", () => {
    expect(PAGE).toContain("if (!seed.order && !seed.then && !seed.generate && (seed.image || seed.text?.trim())) {");
  });
});

describe("chat widget (source)", () => {
  it("no constructor on the page → seed, constructor mode, navigate — never from the showroom", () => {
    expect(WIDGET).toContain('!location.pathname.startsWith("/showroom") &&');
    expect(WIDGET).toContain("seedMockupForConstructor(suggestion.mockup, sentAttachment)");
    expect(WIDGET).toContain('setMode("simple");\n      navigate(CONSTRUCTOR_URL);');
  });
  it("the picture is shown in the bubble and is not persisted; the pending flag is", () => {
    expect(WIDGET).toContain("src={m.sketch}");
    const slim = WIDGET.slice(WIDGET.indexOf("const slim: PersistedChatMsg[]"), WIDGET.indexOf('saveChat("widget"'));
    expect(slim).toContain("sketchPending: m.sketchPending,");
    expect(slim).not.toContain("sketch: m.sketch");
  });
});

describe("/chat page (source)", () => {
  it("hands its conversation to the widget's slot, open and waiting for the picture, then goes to the constructor", () => {
    expect(CHATPAGE).toContain("seedMockupForConstructor(suggestion.mockup, sentAttachment)");
    expect(CHATPAGE).toContain('{ role: "assistant" as const, content: reply, suggestion, autoApplied: true, sketchPending: true },');
    expect(CHATPAGE).toContain('saveChat("widget", sessionIdRef.current, carried, true);');
    const at = CHATPAGE.indexOf('saveChat("widget", sessionIdRef.current, carried, true);');
    expect(CHATPAGE.indexOf("navigate(CONSTRUCTOR_URL);", at)).toBeGreaterThan(at);
  });
});
