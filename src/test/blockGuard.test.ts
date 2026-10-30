import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  guardSketchBlocks,
  mentionsColour,
  userTurnsFromMessages,
  CATALOG_COLOUR_NAMES,
  SERVER_PLACEHOLDER_TEXTS,
  ASK_FOR_DESIGN_KA,
  ASK_FOR_DESIGN_EN,
} from "../../supabase/functions/gemini-proxy/blockGuard";
import { sanitizeReply } from "../../supabase/functions/gemini-proxy/replySanitize";
import { COLORS } from "@/lib/catalog";
import { PLACEHOLDER_TEXTS } from "@/lib/mockupSuggestion";

const mock = (o: Record<string, unknown>) => "```maika-mockup\n" + JSON.stringify(o) + "\n```";
const gen = (o: Record<string, unknown>) => "```maika-generate\n" + JSON.stringify(o) + "\n```";
const ctx = (userTurns: string[], hasImage = false) => ({ userTurns, hasImage });

describe("mentionsColour", () => {
  it.each(["შავ მაისურზე", "თეთრი", "წითლად", "ლურჯი ჰუდი", "ცისფერი", "ყვითელი", "მწვანე", "ნაცრისფერი",
    "რუხი", "ვარდისფერი", "იასამნისფერი", "ნარინჯისფერი", "ყავისფერი", "ბეჟი", "მუქი", "ღია ფერის",
    "on a black shirt", "Navy please", "GREY", "Electric Blue", "Sol's Emerald"])("%j → true", (t) => {
    expect(mentionsColour([t])).toBe(true);
  });
  it.each(["როგორ გამოვა ეს მაისურზე?", "რა ფასი იქნება?", "https://example.com/x.jpg", "M ზომა მინდა",
    "მხოლოდ ლოგო დატოვე", "დაშავდა?", "how much is it?"])("%j → false", (t) => {
    expect(mentionsColour([t])).toBe(false);
  });
  it("every catalog colour name counts as named", () => {
    for (const c of COLORS) expect(mentionsColour([c.name]), c.name).toBe(true);
    expect(new Set(CATALOG_COLOUR_NAMES)).toEqual(new Set(COLORS.map((c) => c.name)));
  });
});

describe("userTurnsFromMessages", () => {
  it("keeps only user string turns of the last 8, like the model's history", () => {
    const msgs = [
      ...Array.from({ length: 6 }, (_, i) => ({ role: "user", content: "old" + i })),
      { role: "assistant", content: "a" },
      { role: "system", content: "s" },
      { role: "user", content: "შავი" },
      { role: "user", content: ["not a string"] },
      { role: "assistant", content: "b" },
      { role: "user", content: "ბოლო" },
    ];
    expect(userTurnsFromMessages(msgs)).toEqual(["old2", "old3", "old4", "old5", "შავი", "ბოლო"]);
    expect(userTurnsFromMessages(undefined)).toEqual([]);
  });
});

describe("guardSketchBlocks — colour", () => {
  it("no fence → same string", () => {
    const t = "ფასი 35₾.";
    expect(guardSketchBlocks(t, ctx([]))).toBe(t);
  });

  it("sets color White when no customer turn names one (photo case)", () => {
    const t = "ჩვენს მაისურზე ასე დაიბეჭდება.\n" + mock({ product: "T-Shirt", subProduct: "GILDAN", color: "Red", side: "front" });
    expect(guardSketchBlocks(t, ctx(["როგორ გამოვა ეს მაისურზე?"], true))).toBe(
      "ჩვენს მაისურზე ასე დაიბეჭდება.\n" + mock({ product: "T-Shirt", subProduct: "GILDAN", color: "White", side: "front" }),
    );
  });

  it("maika-generate: invented colour → White, missing colour → White, White → unchanged", () => {
    const t = "კარგი.\n" + gen({ prompt: "ლომი", style: "Realistic", color: "Black" });
    expect(guardSketchBlocks(t, ctx(["დამიხატე ლომი"]))).toBe("კარგი.\n" + gen({ prompt: "ლომი", style: "Realistic", color: "White" }));
    const w = "კარგი.\n" + gen({ prompt: "ლომი", style: "Realistic", color: "White" });
    expect(guardSketchBlocks(w, ctx(["დამიხატე ლომი"]))).toBe(w);
  });

  it("keeps color when any customer turn of the request named a colour; textColor never touched", () => {
    const block = mock({ text: "ნიკა", color: "Black", textColor: "White" });
    const t = "ნიკა.\n" + block;
    expect(guardSketchBlocks(t, ctx(["შავ მაისურზე მინდა", "ნიკა დაწერე"]))).toBe(t);
    expect(guardSketchBlocks(t, ctx(["ნიკა დაწერე"]))).toBe("ნიკა.\n" + mock({ text: "ნიკა", color: "White", textColor: "White" }));
  });

  it("leaves an unparsable fence alone", () => {
    const t = "x\n```maika-mockup\n{not json\n```";
    expect(guardSketchBlocks(t, ctx([]))).toBe(t);
  });
});

describe("guardSketchBlocks — empty mockup", () => {
  it("drops a bare mockup without image and asks for the design", () => {
    const t = mock({ product: "T-Shirt", side: "front" });
    // a pasted URL has no Georgian script → the English question
    expect(guardSketchBlocks(t, ctx(["https://shop.example/item/123"]))).toBe(ASK_FOR_DESIGN_EN);
  });

  it("asks in Georgian when the customer writes Georgian", () => {
    const t = mock({ product: "T-Shirt", side: "front" });
    expect(guardSketchBlocks(t, ctx(["მხოლოდ ლოგო დატოვე"]))).toBe(ASK_FOR_DESIGN_KA);
  });

  it("keeps the prose answer, removes only the block (and its announcement)", () => {
    const t = "M ზომა: 74/51 სმ.\nაი, როგორ გამოჩნდება:\n" + mock({ product: "T-Shirt" });
    expect(guardSketchBlocks(t, ctx(["M ზომა რამხელაა?"]))).toBe("M ზომა: 74/51 სმ.");
  });

  it("placeholder text counts as no text", () => {
    const t = "ფორმაზე გვარს და ნომერს დაგიწერთ, 20₾.\n" + mock({ text: "გვარი\n00" });
    expect(guardSketchBlocks(t, ctx(["ფორმაზე გვარი მინდა"]))).toBe("ფორმაზე გვარს და ნომერს დაგიწერთ, 20₾.");
  });

  it("removeBackground / editPrompt without an image are removed; block with nothing else dropped", () => {
    expect(guardSketchBlocks("ok.\n" + mock({ removeBackground: true }), ctx(["ფონი მოაშორე"]))).toBe("ok.");
    expect(guardSketchBlocks("ok.\n" + mock({ editPrompt: "დაადე ქუდი" }), ctx(["დაადე ქუდი"]))).toBe("ok.");
    expect(guardSketchBlocks("ok.\n" + mock({ text: "ნიკა", removeBackground: true, editPrompt: "x" }), ctx(["ნიკა"])))
      .toBe("ok.\n" + mock({ text: "ნიკა", color: "White" }));
  });

  it("keeps the block with an image, with real text, or with removeWhite", () => {
    const photo = "ok.\n" + mock({ product: "T-Shirt", removeBackground: true, color: "White" });
    expect(guardSketchBlocks(photo, ctx(["ფონი მოაშორე"], true))).toBe(photo);
    const txt = "ok.\n" + mock({ text: "საქართველო", color: "White" });
    expect(guardSketchBlocks(txt, ctx(["საქართველო დაწერე"]))).toBe(txt);
    const rw = "ok.\n" + mock({ removeWhite: true });
    expect(guardSketchBlocks(rw, ctx(["დიზაინიდან ამოიღე ყველა თეთრი ფერი"]))).toBe(rw);
  });

  it("never drops a maika-generate block for lack of an image", () => {
    const t = "კარგი.\n" + gen({ prompt: "ლომი" });
    expect(guardSketchBlocks(t, ctx(["დამიხატე ლომი"]))).toBe("კარგი.\n" + gen({ prompt: "ლომი", color: "White" }));
  });

  it("composes with sanitizeReply as at the call site (no false 'sketch is visible' line)", () => {
    const t = "აი, როგორ გამოჩნდება:\n" + mock({ product: "T-Shirt", color: "White" });
    expect(sanitizeReply(guardSketchBlocks(t, ctx(["https://x.ge/a"])))).toBe(ASK_FOR_DESIGN_EN);
    expect(sanitizeReply(guardSketchBlocks(t, ctx(["ეს ბმული ნახე"])))).toBe(ASK_FOR_DESIGN_KA);
  });
});

describe("faq-chat call site", () => {
  const SRC = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");
  it("guards the reply with this request's user turns + image, before sanitizeReply", () => {
    expect(SRC).toMatch(
      /sanitizeReply\(guardSketchBlocks\(fixBankAccounts\(textContent\), \{\s*userTurns: userTurnsFromMessages\(params\.messages\),\s*hasImage: isAcceptableChatImage\(params\.image\),\s*\}\)\)/,
    );
  });
  it("eval mode still returns the unsanitized model text as raw", () => {
    expect(SRC).toContain("JSON.stringify({ image: null, text: replyText, raw: textContent })");
  });
});

describe("placeholder parity with the client", () => {
  it("server set equals src/lib/mockupSuggestion PLACEHOLDER_TEXTS", () => {
    expect(new Set(SERVER_PLACEHOLDER_TEXTS)).toEqual(new Set(PLACEHOLDER_TEXTS));
  });
});
