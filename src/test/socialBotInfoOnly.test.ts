// Owner 2026-11-20: info-only DM bot + no continuing an operator's conversation after hours.
import { describe, it, expect } from "vitest";
import {
  decideAutoReply,
  nextOpenPhrase,
  operatorClosedMessage,
  OPERATOR_CLOSED_PREFIX,
  type ThreadRow,
} from "../../supabase/functions/meta-webhook/botReply";
import { socialPromptBlock, withSocialBlock } from "../../supabase/functions/gemini-proxy/socialChannel";

// Tbilisi = UTC+4.
const at = (iso: string) => new Date(iso);
const FRI_1903 = at("2026-11-20T15:03:00.000Z"); // Fri 19:03
const SAT_1830 = at("2026-11-21T14:30:00.000Z"); // Sat 18:30
const MON_0200 = at("2026-11-23T22:00:00.000Z"); // Tue 02:00 actually Mon 22:00 UTC → Tue 02:00

const inRow = (id: string, sent_at: string): ThreadRow => ({ meta_message_id: id, direction: "in", text: "კითხვა", attachments: null, unsupported: false, sent_at });

const base = (now: Date, outRows: { meta_message_id: string; text: string | null; sent_at: string }[], botSends: { meta_message_id: string | null; text: string | null; kind: string; created_at: string }[] = []) => {
  const trig = inRow("c2", new Date(now.getTime() - 30_000).toISOString());
  return decideAutoReply({
    settings: { enabled: true, schedule: "off_hours" },
    now,
    handedOff: false,
    outRows,
    botSends,
    tokenSet: true,
    trigger: trig,
    thread: [trig],
    offPeriodTakeover: true,
    operatorClosing: { outRows, botSends },
  });
};

describe("next opening phrase", () => {
  it("Friday evening → tomorrow (Saturday) 11:00", () => {
    expect(nextOpenPhrase("off_hours", FRI_1903)).toBe("ხვალ 11:00-დან");
  });
  it("Saturday 18:30 → Monday 11:00", () => {
    expect(nextOpenPhrase("off_hours", SAT_1830)).toBe("ორშაბათს 11:00-დან");
  });
  it("after midnight → today 11:00", () => {
    expect(nextOpenPhrase("off_hours", MON_0200)).toBe("დღეს 11:00-დან");
  });
  it("the note", () => {
    expect(operatorClosedMessage("off_hours", FRI_1903)).toBe(`${OPERATOR_CLOSED_PREFIX} 🙏 ოპერატორი ხვალ 11:00-დან მოგწერთ.`);
  });
});

describe("operator conversation after hours", () => {
  it("operator wrote at 18:56 → one closing note at 19:03", () => {
    const out = [{ meta_message_id: "o1", text: "მოგესალმებით! ჰუდი 80₾", sent_at: "2026-11-20T14:56:00.000Z" }];
    expect(base(FRI_1903, out)).toEqual({ action: "closed" });
  });
  it("note already sent this evening → silent", () => {
    const out = [{ meta_message_id: "o1", text: "ოპერატორის პასუხი", sent_at: "2026-11-20T14:56:00.000Z" }];
    const sends = [{ meta_message_id: "b1", text: operatorClosedMessage("off_hours", FRI_1903), kind: "reply", created_at: "2026-11-20T15:01:00.000Z" }];
    expect(base(FRI_1903, out, sends)).toEqual({ action: "skip", reason: "operator_thread" });
  });
  it("no operator in the last 24 h → normal bot reply", () => {
    const out = [{ meta_message_id: "o1", text: "ძველი პასუხი", sent_at: "2026-11-18T10:00:00.000Z" }];
    expect(base(FRI_1903, out)).toEqual({ action: "reply" });
  });
  it("only the bot's own earlier messages → normal bot reply", () => {
    const out = [{ meta_message_id: "b0", text: "ბოტის პასუხი", sent_at: "2026-11-20T03:00:00.000Z" }];
    const sends = [{ meta_message_id: "b0", text: "ბოტის პასუხი", kind: "reply", created_at: "2026-11-20T03:00:00.000Z" }];
    expect(base(FRI_1903, out, sends)).toEqual({ action: "reply" });
  });
});

describe("info-only DM prompt", () => {
  const block = socialPromptBlock("messenger", "off_hours", { infoOnly: true, now: FRI_1903 });
  it("forbids sketches, orders and stock claims; exact bank details; unsure → operator", () => {
    expect(block).toContain("INFORMATION ONLY");
    expect(block).toContain("NEVER emit maika-mockup, maika-generate or maika-order");
    expect(block).toContain("Copy the knowledge-base requisites lines EXACTLY");
    expect(block).toContain("NOT SURE?");
    expect(block).toContain("NEVER a plain „yes / დიახ");
    expect(block).toContain("მარაგშია");
    expect(block).toContain("at most ONE price list");
    expect(block).not.toContain("ORDERS HERE");
    expect(block).toContain("GIVEAWAY");
  });
  it("without the flag the full DM block is unchanged", () => {
    expect(socialPromptBlock("messenger", "off_hours")).toContain("SOCIAL DM MODE");
    expect(socialPromptBlock("messenger", "off_hours")).not.toContain("INFORMATION ONLY");
  });
  it("website path untouched", () => {
    expect(withSocialBlock("SYS\n\nCALLER: x", null, "off_hours", { infoOnly: true })).toBe("SYS\n\nCALLER: x");
  });
});

// Owner 2026-11-25: ads list + off-hours sketch offer inside info-only.
import { adsLines, sketchOfferLines, ACTIVE_ADS } from "../../supabase/functions/gemini-proxy/socialChannel";
import { SKETCH_CAVEAT, SKETCH_SYSTEM_LINES, stripSketchSystemText } from "../../supabase/functions/meta-webhook/botReply";

describe("ads + sketch offer (owner 2026-11-25)", () => {
  it("info-only without sketches is unchanged in spirit: no blocks allowed", () => {
    const b = socialPromptBlock("instagram", "off_hours", { infoOnly: true });
    expect(b).toContain("NO SKETCHES, NO DESIGNS, NO ORDERS");
    expect(b).not.toContain("SKETCH OFFER");
    expect(b).toContain("OUR CURRENT ADS");
  });
  it("info-only with sketches: sketch rules in, orders out", () => {
    const b = socialPromptBlock("messenger", "off_hours", { infoOnly: true, sketches: true });
    expect(b).not.toContain("NO SKETCHES, NO DESIGNS");
    expect(b).toContain("SKETCH OFFER");
    expect(b).toContain("NEVER emit maika-order");
    expect(b).toContain("- For a drawing or lettering");
    expect(b).toContain("- THEIR OWN PHOTOS");
    expect(b).toContain("\"extract\":true");
    expect(b).not.toContain("CORPORATE / BULK (owner 2026-11-16)");
    // info-only rules stay
    expect(b).toContain("NEVER say a product, colour or size is in stock");
  });
  it("sketch lines come only from the sketch rules", () => {
    const lines = sketchOfferLines("instagram", "off_hours");
    expect(lines.some((l) => l.startsWith("- PRICE HERE"))).toBe(false);
    expect(lines.some((l) => l.startsWith("- COMPLAINT"))).toBe(false);
  });
  it("the opening ad is named when it matches", () => {
    expect(adsLines("Washed hoodie video | Messenger v1").join("\n")).toContain("THIS customer opened the chat from our ad: მოხარშული");
    expect(adsLines("Tower fleece hoodie | Messenger | B gift").join("\n")).toContain("ტელეანძის");
    expect(adsLines("Something else").join("\n")).not.toContain("THIS customer");
    expect(adsLines(null)).toHaveLength(1);
    expect(ACTIVE_ADS.length).toBeGreaterThan(3);
  });
  it("the caveat is a system line, stripped from history", () => {
    expect(SKETCH_SYSTEM_LINES).toContain(SKETCH_CAVEAT);
    expect(stripSketchSystemText(`ტექსტი\n${SKETCH_CAVEAT}`)).toBe("ტექსტი");
  });
});
