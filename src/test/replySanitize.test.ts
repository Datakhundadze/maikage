import { describe, it, expect } from "vitest";
import { sanitizeReply, stripBlockAnnouncements, MAIKA_WHATSAPP_DISPLAY } from "../../supabase/functions/gemini-proxy/replySanitize";

describe("sanitizeReply", () => {
  it("returns clean text unchanged", () => {
    const t = "ჰუდები S–XXL ზომებშია.\n\n```maika-mockup\n{\"text\":\"ნიკა\"}\n```";
    expect(sanitizeReply(t)).toBe(t);
  });
  it("removes parenthesised section refs", () => {
    expect(sanitizeReply("ჭრა რეგულარია (§10).")).toBe("ჭრა რეგულარია.");
    expect(sanitizeReply("Prices are listed (see §2a) below")).toBe("Prices are listed below");
  });
  it("removes inline section refs and stray §", () => {
    expect(sanitizeReply("არხები §9b-ში წერია")).toBe("არხები წერია");
    expect(sanitizeReply("a § b")).toBe("a b");
  });
  it("replaces WhatsApp markdown links and bare URLs with the number", () => {
    expect(sanitizeReply("მოგვწერეთ [WhatsApp-ზე](https://wa.me/995599050807).")).toBe(`მოგვწერეთ ${MAIKA_WHATSAPP_DISPLAY}.`);
    expect(sanitizeReply("WhatsApp: https://wa.me/995599050807?text=hi")).toBe(`WhatsApp: ${MAIKA_WHATSAPP_DISPLAY}`);
    expect(sanitizeReply("https://api.whatsapp.com/send?phone=995599050807")).toBe(MAIKA_WHATSAPP_DISPLAY);
  });
  it("keeps other links", () => {
    const t = "[www.maika.ge](https://www.maika.ge) · [instagram.com/maika.ge_](https://instagram.com/maika.ge_)";
    expect(sanitizeReply(t)).toBe(t);
  });
});

const MOCK = "```maika-mockup\n{\"text\":\"ნიკა\",\"product\":\"T-Shirt\"}\n```";
const GEN = "```maika-generate\n{\"prompt\":\"ლომი\",\"style\":\"Realistic\"}\n```";

describe("stripBlockAnnouncements (sketch-block audit 2026-10-30)", () => {
  it("does nothing without a maika block (same string)", () => {
    const t = "ესკიზის სანახავად დააჭირეთ ღილაკს: აი, როგორ გამოჩნდება.";
    expect(stripBlockAnnouncements(t)).toBe(t);
    expect(sanitizeReply(t)).toBe(t);
  });

  it("returns a clean block reply unchanged (same string)", () => {
    const t = "ნიკა შავ მაისურზე, მკერდზე თეთრად.\n\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe(t);
  });

  it.each([
    "აი, როგორ გამოჩნდება:",
    "აი ესკიზი:",
    "ესკიზის სანახავად დააჭირეთ ღილაკს:",
    "ესკიზის სანახავად დააჭირეთ ქვედა ღილაკს.",
    "ქვემოთ მოცემულ ღილაკზე დაჭერით ნახავთ ესკიზს.",
    "ქვედა ღილაკით ნახავთ, როგორ გამოიყურება.",
    "შეგიძლიათ ნახოთ, როგორ გამოჩნდება:",
    "პირდაპირ გამოიყენეთ ეს ესკიზი:",
    "აირჩიეთ ფერი, რომ ნახოთ:",
    "აი, თქვენი სახელი შავ მაისურზე:",
  ])("removes the pointer line %j and keeps the answer", (ptr) => {
    const t = "კარგი, ნიკა შავ მაისურზე.\n" + ptr + "\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe("კარგი, ნიკა შავ მაისურზე.\n" + MOCK);
  });

  it("cuts a trailing pointer clause and keeps the head", () => {
    const t = "საქართველო შავ მაისურზე — ესკიზის სანახავად დააჭირეთ ღილაკს:\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe("საქართველო შავ მაისურზე.\n" + MOCK);
    const t2 = "ფერი შავია, შეგიძლიათ ნახოთ, როგორ გამოჩნდება:\n" + MOCK;
    expect(stripBlockAnnouncements(t2)).toBe("ფერი შავია.\n" + MOCK);
  });

  it("removes a pointer sentence inside a line, keeps the rest of the line", () => {
    const t = "GILDAN მაისური 35₾-ია. აი, როგორ გამოჩნდება: \n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe("GILDAN მაისური 35₾-ია.\n" + MOCK);
  });

  it("never removes a price or a question; strips only the pointer clause of it", () => {
    const price = "ესკიზის სანახავად დააჭირეთ ღილაკს — ფასი 35₾.\n" + MOCK;
    expect(stripBlockAnnouncements(price)).toBe("ფასი 35₾.\n" + MOCK);
    const q = "აი, როგორ გამოჩნდება — გნებავთ ზურგზეც?\n" + MOCK;
    expect(stripBlockAnnouncements(q)).toBe("გნებავთ ზურგზეც?\n" + MOCK);
    const inseparable = "აი როგორ გამოჩნდება 35₾-ად\n" + MOCK;
    expect(stripBlockAnnouncements(inseparable)).toBe(inseparable);
  });

  it("never touches the fenced block itself", () => {
    const fence = "```maika-mockup\n{\"text\":\"აი ესკიზი: დააჭირეთ ღილაკს\"}\n```";
    const t = "აი ესკიზი:\n" + fence;
    const out = stripBlockAnnouncements(t);
    expect(out.endsWith(fence)).toBe(true);
    expect(out).not.toContain("აი ესკიზი:\n");
  });

  it("never leaves the prose empty", () => {
    expect(stripBlockAnnouncements("აი, როგორ გამოჩნდება:\n" + MOCK)).toBe("ესკიზი კონსტრუქტორში უკვე ჩანს.\n\n" + MOCK);
    expect(stripBlockAnnouncements("Here is the sketch:\n" + MOCK)).toBe("The sketch is already on the product in the constructor.\n\n" + MOCK);
    expect(stripBlockAnnouncements("ქვედა ღილაკით:\n" + GEN)).toBe("კარგი.\n\n" + GEN);
  });

  it("handles English pointers and maika-generate", () => {
    const t = "A lion in Realistic style. Click the button below to see it.\n" + GEN;
    expect(stripBlockAnnouncements(t)).toBe("A lion in Realistic style.\n" + GEN);
  });

  it("drops a bare „აი, “ lead-in but keeps its content", () => {
    const t = "აი, საქართველო შავ მაისურზე.\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe("საქართველო შავ მაისურზე.\n" + MOCK);
  });

  it("keeps a colon list header that is not right before the block", () => {
    const t = "აი ფასები:\n- GILDAN 35₾\n- TH 45₾\n\nესკიზის სანახავად დააჭირეთ ღილაკს.\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe("აი ფასები:\n- GILDAN 35₾\n- TH 45₾\n\n" + MOCK);
  });

  it("realistic multi-paragraph reply: only the pointer goes", () => {
    const t =
      "„ნიკა\" შავ GILDAN მაისურზე, თეთრი ასოებით.\n\nფასი: 35₾ (ცალმხრივი).\n\n" +
      "ქვემოთ მოცემულ ღილაკზე დაჭერით შეგიძლიათ ნახოთ, როგორ გამოჩნდება ესკიზი:\n\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe(
      "„ნიკა\" შავ GILDAN მაისურზე, თეთრი ასოებით.\n\nფასი: 35₾ (ცალმხრივი).\n\n" + MOCK,
    );
  });

  it("does not mistake „აირჩიეთ“ for „აი“", () => {
    const t = "აირჩიეთ ზომა შეკვეთისას.\n" + MOCK;
    expect(stripBlockAnnouncements(t)).toBe(t);
  });

  it("is wired into sanitizeReply after the § step", () => {
    const t = "ნიკა შავ მაისურზე (§12). აი, როგორ გამოჩნდება:\n" + MOCK;
    expect(sanitizeReply(t)).toBe("ნიკა შავ მაისურზე.\n" + MOCK);
  });
});
