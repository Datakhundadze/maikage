import { describe, it, expect } from "vitest";
import { sanitizeReply, MAIKA_WHATSAPP_DISPLAY } from "../../supabase/functions/gemini-proxy/replySanitize";

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
