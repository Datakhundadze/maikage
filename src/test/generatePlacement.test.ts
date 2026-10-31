import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseGenerateSuggestion,
  parseGeneratePlacement,
  parseChatSuggestion,
  openGenerateInConstructor,
} from "@/lib/generateSuggestion";
import { consumeConstructorSeed, normalizeConstructorSeed, type ConstructorSeed } from "@/lib/constructorSeed";
import { CONSTRUCTOR_APPLY_EVENT } from "@/lib/constructorBridge";

const block = (json: string) => "პასუხი\n```maika-generate\n" + json + "\n```";

describe("maika-generate placement — parse", () => {
  it("accepts the four placements, case- and whitespace-insensitively", () => {
    expect(parseGenerateSuggestion(block('{"prompt":"გული","placement":"left-chest"}'))?.placement).toBe("left-chest");
    expect(parseGenerateSuggestion(block('{"prompt":"გული","placement":" Right-Chest "}'))?.placement).toBe("right-chest");
    expect(parseGenerateSuggestion(block('{"prompt":"გული","placement":"SMALL"}'))?.placement).toBe("small");
    expect(parseGenerateSuggestion(block('{"prompt":"გული","placement":"center"}'))?.placement).toBe("center");
  });

  it("drops jersey-back, unknown values and non-strings", () => {
    for (const raw of ['"jersey-back"', '"chest"', '"left chest"', '"leftchest"', "1", "true", "null", '""']) {
      const g = parseGenerateSuggestion(block(`{"prompt":"გული","placement":${raw}}`));
      expect(g, raw).not.toBeNull();
      expect(g?.placement, raw).toBeUndefined();
    }
  });

  it("an invalid placement drops only itself — the rest of the block survives", () => {
    const g = parseGenerateSuggestion(block('{"prompt":"გული","side":"front","placement":"jersey-back"}'));
    expect(g?.prompt).toBe("გული");
    expect(g?.side).toBe("front");
    expect(g && "placement" in g).toBe(false);
  });

  it("a block without placement has no placement key (unchanged shape)", () => {
    const g = parseGenerateSuggestion(block('{"prompt":"გული"}'));
    expect(g && "placement" in g).toBe(false);
  });

  it("parseChatSuggestion carries it through", () => {
    const r = parseChatSuggestion(block('{"prompt":"პატარა გული","placement":"left-chest"}'), false);
    expect(r.suggestion?.kind).toBe("generate");
    if (r.suggestion?.kind === "generate") expect(r.suggestion.generate.placement).toBe("left-chest");
  });

  it("parseGeneratePlacement is the closed set", () => {
    expect(parseGeneratePlacement("Left-Chest")).toBe("left-chest");
    expect(parseGeneratePlacement("jersey-back")).toBeUndefined();
    expect(parseGeneratePlacement(undefined)).toBeUndefined();
    expect(parseGeneratePlacement({})).toBeUndefined();
  });
});

describe("maika-generate placement — seed handoff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  /** Capture what a live constructor would receive, claiming it. */
  const captureInPlace = (): { get: () => ConstructorSeed | null; stop: () => void } => {
    let got: ConstructorSeed | null = null;
    const onApply = (e: Event) => {
      got = normalizeConstructorSeed((e as CustomEvent<ConstructorSeed>).detail);
      e.preventDefault();
    };
    window.addEventListener(CONSTRUCTOR_APPLY_EVENT, onApply);
    return { get: () => got, stop: () => window.removeEventListener(CONSTRUCTOR_APPLY_EVENT, onApply) };
  };

  it("in-place: the normalized seed carries the top-level placement next to generate", () => {
    const cap = captureInPlace();
    const g = parseGenerateSuggestion(block('{"prompt":"პატარა გული","placement":"left-chest"}'));
    expect(g).not.toBeNull();
    expect(openGenerateInConstructor(g!)).toBe(true);
    cap.stop();
    const seed = cap.get();
    expect(seed?.placement).toBe("left-chest");
    expect(seed?.generate?.prompt).toBe("პატარა გული");
  });

  it("new tab: the stored seed carries the placement through consumeConstructorSeed", () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const g = parseGenerateSuggestion(block('{"prompt":"გული","placement":"small"}'));
    expect(openGenerateInConstructor(g!)).toBe(true);
    const seed = consumeConstructorSeed();
    expect(seed?.placement).toBe("small");
    expect(seed?.generate?.prompt).toBe("გული");
  });

  it("no placement → the seed has none, exactly as before", () => {
    vi.spyOn(window, "open").mockReturnValue({} as Window);
    const g = parseGenerateSuggestion(block('{"prompt":"გული"}'));
    openGenerateInConstructor(g!);
    const raw = JSON.parse(localStorage.getItem("maika-constructor-seed") as string);
    expect("placement" in raw).toBe(false);
    expect(consumeConstructorSeed()?.placement).toBeUndefined();
  });

  it("the generate payload itself is unchanged — placement rides at the seed's top level", () => {
    const cap = captureInPlace();
    const g = parseGenerateSuggestion(block('{"prompt":"გული","placement":"right-chest"}'));
    openGenerateInConstructor(g!);
    cap.stop();
    expect(Object.keys(cap.get()?.generate ?? {}).sort()).toEqual(["prompt", "style", "withBackground"]);
  });
});
