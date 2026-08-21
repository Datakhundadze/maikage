import { describe, it, expect } from "vitest";
// Imported from the edge function itself rather than a copy, so the thing under
// test IS the thing that runs in production. redactPii.ts is plain TypeScript
// with no Deno APIs, so vitest can load it directly.
import { redactPii } from "../../supabase/functions/gemini-proxy/redactPii";

describe("redactPii — phone numbers", () => {
  it("masks a bare Georgian mobile, keeping the last two digits", () => {
    expect(redactPii("ჩემი ნომერია 577123456")).toBe("ჩემი ნომერია [phone:***56]");
  });

  it("masks the spaced form customers actually type", () => {
    expect(redactPii("დამირეკეთ 577 12 34 56")).toBe("დამირეკეთ [phone:***56]");
  });

  it("masks the international form", () => {
    expect(redactPii("+995 577 12 34 56")).toBe("[phone:***56]");
  });

  it("masks dashed and parenthesised forms", () => {
    expect(redactPii("577-12-34-56")).toBe("[phone:***56]");
    expect(redactPii("(995) 577 123 456")).toBe("[phone:***56]");
  });

  it("masks more than one number in a turn", () => {
    expect(redactPii("577123456 ან 599887766")).toBe("[phone:***56] ან [phone:***66]");
  });
});

describe("redactPii — leaves ordinary chat alone", () => {
  it("does not touch prices, quantities or sizes", () => {
    const s = "მინდა 25 მაისური, ზომა XL, ფასი 30 ლარი, სულ 750";
    expect(redactPii(s)).toBe(s);
  });

  it("does not touch an ISO date (8 digits, below the floor)", () => {
    expect(redactPii("შეკვეთა 2026-08-21")).toBe("შეკვეთა 2026-08-21");
  });

  it("passes empty and undefined-ish input straight through", () => {
    expect(redactPii("")).toBe("");
    expect(redactPii("გამარჯობა")).toBe("გამარჯობა");
  });
});

describe("redactPii — our own published contact details survive", () => {
  it("keeps the showroom landline the bot is told to hand out", () => {
    const s = "დაგვირეკეთ: +995 32 2 05 06 20";
    expect(redactPii(s)).toBe(s);
  });

  it("keeps the WhatsApp ordering number", () => {
    const s = "WhatsApp: +995 599 05 08 07";
    expect(redactPii(s)).toBe(s);
  });

  it("keeps the support address", () => {
    expect(redactPii("მოგვწერეთ maika@maika.ge")).toBe("მოგვწერეთ maika@maika.ge");
  });
});

describe("redactPii — email addresses", () => {
  it("keeps the first character and the domain", () => {
    expect(redactPii("giorgi@gmail.com")).toBe("[email:g***@gmail.com]");
  });

  it("masks an address inside a sentence", () => {
    expect(redactPii("ჩემი მეილია nino.b@example.co.uk, მომწერეთ")).toBe(
      "ჩემი მეილია [email:n***@example.co.uk], მომწერეთ",
    );
  });

  it("does not let a digit-heavy local part get half-eaten by the phone pass", () => {
    // Emails run first precisely so this cannot produce a mangled result.
    expect(redactPii("user1234567890@example.com")).toBe("[email:u***@example.com]");
  });
});

describe("redactPii — combined", () => {
  it("handles a realistic order-status message", () => {
    expect(
      redactPii("გამარჯობა, შეკვეთა გავაკეთე, ნომერი 599112233, მეილი ana@mail.ru"),
    ).toBe("გამარჯობა, შეკვეთა გავაკეთე, ნომერი [phone:***33], მეილი [email:a***@mail.ru]");
  });
});
