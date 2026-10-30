import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// gemini-proxy is a Deno module (https imports), so it cannot be imported
// here. These assertions read its SOURCE, which is what gets deployed.
const SRC = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");

/** The FAQ_KB template literal's body. */
function faqKb(): string {
  const start = SRC.indexOf("const FAQ_KB = `");
  expect(start).toBeGreaterThan(-1);
  const end = SRC.indexOf("\n`;", start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

function setMembers(name: string): string[] {
  const m = SRC.match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
  expect(m).not.toBeNull();
  return [...(m as RegExpMatchArray)[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** The body of one `else if (action === "...")` branch, up to the next branch. */
function branch(action: string): string {
  const start = SRC.indexOf(`} else if (action === "${action}") {`);
  expect(start).toBeGreaterThan(-1);
  const next = SRC.indexOf("} else if (action ===", start + 10);
  return SRC.slice(start, next);
}

describe("FAQ_KB reply hygiene (site assistant)", () => {
  const kb = faqKb();

  it("forbids Latin letters inside Georgian words, with the logged example", () => {
    expect(kb).toContain("NEVER mix Latin letters inside a Georgian word");
    expect(kb).toContain("„construct-ორიდან\" — that is a BUG");
    expect(kb).toContain("„კონსტრუქტორიდან\"");
  });

  it("requires real Georgian UI labels and bans English feature names", () => {
    expect(kb).toContain("ONLY by its real Georgian label");
    expect(kb).toContain("„ფონის მოხსნა\"");
    expect(kb).toContain("\"Background Removal\"");
  });

  it("tells the assistant to use the action instead of manual instructions", () => {
    expect(kb).toContain("USE THE BLOCK. Never tell them to do it by hand when the action exists.");
  });

  it("documents the removeWhite block with the logged request as its example", () => {
    expect(kb).toContain("„დიზაინიდან ამოიღე ყველა თეთრი ფერი\"");
    expect(kb).toContain("{\"removeWhite\":true}");
    expect(kb).toContain("removeWhite: true | omit");
  });
});

describe("gemini-proxy cutout actions (add-only)", () => {
  it("both new actions are billable and pro-tier for guests; existing members unchanged", () => {
    expect(setMembers("BILLABLE_ACTIONS")).toEqual([
      "generate-design", "virtual-tryon", "upscale", "isolate-subject", "restyle", "edit-image",
      "isolate-design", "edit-image-cutout", "isolate-subject-gpt", "restyle-gpt", "generate-design-gpt",
    ]);
    expect(setMembers("PRO_TIER_GUEST_ACTIONS")).toEqual([
      "isolate-subject", "restyle", "edit-image", "isolate-design", "edit-image-cutout",
      "isolate-subject-gpt", "restyle-gpt",
    ]);
  });

  it("isolate-design keeps all lettering and replaces only the background with #00FF00", () => {
    const b = branch("isolate-design");
    expect(b).toContain('model = "google/gemini-3-pro-image"');
    expect(b).toContain("Replace ONLY its background");
    expect(b).toContain("ALL text and lettering — Georgian and Latin");
    expect(b).toContain("checkerboard");
    expect(b).toContain("Never use this green");
  });

  it("edit-image-cutout renders on #00FF00 and forbids a checkerboard", () => {
    const b = branch("edit-image-cutout");
    expect(b).toContain('model = "google/gemini-3-pro-image"');
    expect(b).toContain("PURE \" +\n        \"BRIGHT GREEN #00FF00");
    expect(b).toContain("NEVER draw a checkerboard");
  });

  it("the existing edit-image guard is untouched", () => {
    const b = branch("edit-image");
    expect(b).toContain(
      '"everything the instruction does not ask to change — subject " +\n        "identity, pose, colors, composition, background, lighting — exactly " +',
    );
  });
});
