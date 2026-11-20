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
