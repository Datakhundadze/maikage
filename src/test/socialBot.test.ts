// @vitest-environment node
//
// Social DM auto-reply bot: schedule, decision, handoff regex, echo detection,
// reply cleaning, the orchestration with fakes, and the gemini-proxy social
// channel — including that the website faq-chat path is unchanged without it.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isScheduleActive, tbilisiClock } from "../../supabase/functions/meta-webhook/botSchedule";
import {
  BOT_METADATA,
  DESIGN_LINK_LINE,
  HANDOFF_RE,
  IG_MAX_BYTES,
  MAX_BOT_MESSAGES_PER_WINDOW,
  MAX_REPLY_CHARS,
  buildHistory,
  cleanBotReply,
  decideAutoReply,
  handoffMessage,
  humanTookOver,
  isBotCandidate,
  isBotEcho,
  sendBody,
  splitForChannel,
  wantsHuman,
  type BotSendRecord,
  type DecideInput,
  type ThreadRow,
} from "../../supabase/functions/meta-webhook/botReply";
import {
  _resetTokenWarning,
  runAutoReply,
  scrubSecrets,
  type AutoReplyDeps,
  type TriggerRow,
} from "../../supabase/functions/meta-webhook/autoReply";
import {
  resolveTrustedSocialChannel,
  socialPromptBlock,
  withSocialBlock,
} from "../../supabase/functions/gemini-proxy/socialChannel";

// Asia/Tbilisi is UTC+4 all year.
const tbilisi = (iso: string) => new Date(`${iso}+04:00`);
// 2026-11-01 is a Sunday.
const SUNDAY_NOON = tbilisi("2026-11-01T12:00:00");

describe("botSchedule", () => {
  it("reads the Tbilisi clock, not UTC", () => {
    // 2026-10-31T20:30Z is Sunday 00:30 in Tbilisi.
    expect(tbilisiClock(new Date("2026-10-31T20:30:00Z"))).toEqual({ weekday: 0, minutes: 30 });
    expect(tbilisiClock(tbilisi("2026-11-02T11:05:00"))).toEqual({ weekday: 1, minutes: 665 });
  });

  it("'sunday' covers exactly Sunday 00:00–23:59 Tbilisi", () => {
    expect(isScheduleActive("sunday", tbilisi("2026-10-31T23:59:59"))).toBe(false); // Sat
    expect(isScheduleActive("sunday", tbilisi("2026-11-01T00:00:00"))).toBe(true);
    expect(isScheduleActive("sunday", SUNDAY_NOON)).toBe(true);
    expect(isScheduleActive("sunday", tbilisi("2026-11-01T23:59:59"))).toBe(true);
    expect(isScheduleActive("sunday", tbilisi("2026-11-02T00:00:00"))).toBe(false); // Mon
    // UTC Saturday evening is already Sunday in Tbilisi.
    expect(isScheduleActive("sunday", new Date("2026-10-31T20:00:00Z"))).toBe(true);
    expect(isScheduleActive("sunday", new Date("2026-10-31T19:59:59Z"))).toBe(false);
  });

  it("'off_hours' = Sunday + weekdays outside 11–19 + Saturday outside 11–18", () => {
    expect(isScheduleActive("off_hours", SUNDAY_NOON)).toBe(true);
    expect(isScheduleActive("off_hours", tbilisi("2026-11-02T10:59:00"))).toBe(true);
    expect(isScheduleActive("off_hours", tbilisi("2026-11-02T11:00:00"))).toBe(false);
    expect(isScheduleActive("off_hours", tbilisi("2026-11-02T18:59:00"))).toBe(false);
    expect(isScheduleActive("off_hours", tbilisi("2026-11-02T19:00:00"))).toBe(true);
    expect(isScheduleActive("off_hours", tbilisi("2026-11-06T18:30:00"))).toBe(false); // Fri
    expect(isScheduleActive("off_hours", tbilisi("2026-10-31T17:59:00"))).toBe(false); // Sat
    expect(isScheduleActive("off_hours", tbilisi("2026-10-31T18:00:00"))).toBe(true);
    expect(isScheduleActive("off_hours", tbilisi("2026-10-31T10:30:00"))).toBe(true);
  });

  it("an unknown schedule is never active", () => {
    expect(isScheduleActive("always", SUNDAY_NOON)).toBe(false);
    expect(isScheduleActive(null, SUNDAY_NOON)).toBe(false);
  });
});

describe("handoff regex", () => {
  it.each(["ოპერატორი", "ოპერატორთან დამაკავშირეთ", "Operator please", "ადამიანს მინდა", "talk to a human", "ცოცხალი ადამიანი"])(
    "matches %s",
    (t) => expect(wantsHuman(t)).toBe(true),
  );
  it.each(["გამარჯობა", "მაისური რა ღირს?", "hoodie price", "", null])("does not match %s", (t) => {
    expect(wantsHuman(t as string | null)).toBe(false);
  });
  it("is the documented pattern", () => {
    expect(HANDOFF_RE.source).toBe("ოპერატორ|operator|ადამიან|human|ცოცხალ");
    expect(HANDOFF_RE.flags).toContain("i");
  });
  it("Sunday handoff text is the fixed message", () => {
    expect(handoffMessage("sunday")).toBe(
      "კარგი, ოპერატორს გადავეცი 🙌 ის გიპასუხებთ ორშაბათს, 11:00-დან.",
    );
  });
});

describe("bot echo detection", () => {
  const sends: BotSendRecord[] = [
    { meta_message_id: "m_bot1", text: "გამარჯობა!", kind: "reply", created_at: "2026-11-01T08:00:00.000Z" },
    { meta_message_id: null, text: "ფასი 25 ლარია", kind: "reply", created_at: "2026-11-01T09:00:00.000Z" },
  ];
  it("recognises a bot send by message id", () => {
    expect(isBotEcho({ meta_message_id: "m_bot1", text: "anything", sent_at: "2026-11-01T08:00:01Z" }, sends)).toBe(true);
  });
  it("recognises a bot send by text near in time (mid not written back yet / IG mid differs)", () => {
    expect(isBotEcho({ meta_message_id: "m_x", text: "ფასი 25 ლარია", sent_at: "2026-11-01T09:00:02Z" }, sends)).toBe(true);
  });
  it("same text hours later is not a bot echo", () => {
    expect(isBotEcho({ meta_message_id: "m_y", text: "ფასი 25 ლარია", sent_at: "2026-11-01T12:00:00Z" }, sends)).toBe(false);
  });
  it("an operator reply is human", () => {
    const op = { meta_message_id: "m_op", text: "გამარჯობა, დავითი ვარ", sent_at: "2026-11-01T09:30:00Z" };
    expect(isBotEcho(op, sends)).toBe(false);
    expect(humanTookOver([op], sends, new Date("2026-11-01T10:00:00Z"))).toBe(true);
    // older than 12 h → no longer counts
    expect(humanTookOver([op], sends, new Date("2026-11-01T22:00:00Z"))).toBe(false);
  });
  it("Messenger sends carry the metadata marker; Instagram sends do not", () => {
    expect(sendBody("messenger", "psid", "hi")).toEqual({
      recipient: { id: "psid" }, messaging_type: "RESPONSE", message: { text: "hi", metadata: BOT_METADATA },
    });
    expect(sendBody("instagram", "igsid", "hi")).toEqual({
      recipient: { id: "igsid" }, messaging_type: "RESPONSE", message: { text: "hi" },
    });
  });
});

const row = (o: Partial<ThreadRow> & { meta_message_id: string; sent_at: string }): ThreadRow => ({
  direction: "in", text: null, attachments: [], unsupported: false, ...o,
});

function decideInput(o: Partial<DecideInput> = {}): DecideInput {
  const trig = row({ meta_message_id: "m3", text: "რა ღირს მაისური?", sent_at: "2026-11-01T08:00:00Z" });
  return {
    settings: { enabled: true, schedule: "sunday" },
    now: SUNDAY_NOON,
    handedOff: false,
    outRows: [],
    botSends: [],
    tokenSet: true,
    trigger: { meta_message_id: trig.meta_message_id, sent_at: trig.sent_at },
    thread: [trig],
    ...o,
  };
}

describe("decideAutoReply", () => {
  it("replies when everything holds", () => {
    expect(decideAutoReply(decideInput())).toEqual({ action: "reply" });
  });
  it("skips when disabled, missing settings, or outside the schedule", () => {
    expect(decideAutoReply(decideInput({ settings: { enabled: false, schedule: "sunday" } }))).toEqual({ action: "skip", reason: "disabled" });
    expect(decideAutoReply(decideInput({ settings: null }))).toEqual({ action: "skip", reason: "disabled" });
    expect(decideAutoReply(decideInput({ now: tbilisi("2026-11-02T12:00:00") }))).toEqual({ action: "skip", reason: "outside_schedule" });
  });
  it("skips a handed-off conversation", () => {
    expect(decideAutoReply(decideInput({ handedOff: true }))).toEqual({ action: "skip", reason: "handed_off" });
  });
  it("skips when a human replied within 12 h, not when only the bot did", () => {
    const out = { meta_message_id: "m_op", text: "ოპერატორის პასუხი", sent_at: "2026-11-01T07:00:00Z" };
    expect(decideAutoReply(decideInput({ outRows: [out] }))).toEqual({ action: "skip", reason: "human_active" });
    const bot: BotSendRecord = { meta_message_id: "m_op", text: null, kind: "reply", created_at: "2026-11-01T07:00:00Z" };
    expect(decideAutoReply(decideInput({ outRows: [out], botSends: [bot] }))).toEqual({ action: "reply" });
  });
  it("skips without a token", () => {
    expect(decideAutoReply(decideInput({ tokenSet: false }))).toEqual({ action: "skip", reason: "no_token" });
  });
  it("lets the newest message of a burst answer", () => {
    const newer = row({ meta_message_id: "m4", text: "და ჰუდი?", sent_at: "2026-11-01T08:00:05Z" });
    const i = decideInput();
    expect(decideAutoReply({ ...i, thread: [...i.thread, newer] })).toEqual({ action: "skip", reason: "superseded" });
  });
  it("hands off when any pending message asks for a human", () => {
    const thread = [
      row({ meta_message_id: "m2", text: "ოპერატორი", sent_at: "2026-11-01T07:59:58Z" }),
      row({ meta_message_id: "m3", text: "გამარჯობა", sent_at: "2026-11-01T08:00:00Z" }),
    ];
    expect(decideAutoReply(decideInput({ thread }))).toEqual({ action: "handoff" });
  });
  it("a request for a human before the bot's last answer does not count again", () => {
    const thread = [
      row({ meta_message_id: "m1", text: "ოპერატორი", sent_at: "2026-11-01T07:00:00Z" }),
      row({ meta_message_id: "b1", direction: "out", text: "x", sent_at: "2026-11-01T07:00:05Z" }),
      row({ meta_message_id: "m3", text: "კიდევ ერთი", sent_at: "2026-11-01T08:00:00Z" }),
    ];
    const botSends: BotSendRecord[] = [{ meta_message_id: "b1", text: "x", kind: "reply", created_at: "2026-11-01T07:00:05Z" }];
    const outRows = [{ meta_message_id: "b1", text: "x", sent_at: "2026-11-01T07:00:05Z" }];
    expect(decideAutoReply(decideInput({ thread, botSends, outRows }))).toEqual({ action: "reply" });
  });
  it("acknowledges a photo once, then answers text normally", () => {
    const photo = row({ meta_message_id: "m3", attachments: [{ type: "image", url: "u" }], sent_at: "2026-11-01T08:00:00Z" });
    expect(decideAutoReply(decideInput({ thread: [photo] }))).toEqual({ action: "photo" });
    const sent: BotSendRecord = { meta_message_id: "p1", text: "ფოტო", kind: "photo", created_at: "2026-11-01T07:00:00Z" };
    expect(decideAutoReply(decideInput({ thread: [photo], botSends: [sent] }))).toEqual({ action: "skip", reason: "photo_already_acknowledged" });
    const photoText = { ...photo, text: "ასეთი შეგიძლიათ?" };
    expect(decideAutoReply(decideInput({ thread: [photoText], botSends: [sent] }))).toEqual({ action: "reply" });
  });
  it("caps bot messages per conversation", () => {
    const botSends = Array.from({ length: MAX_BOT_MESSAGES_PER_WINDOW }, (_, n) => ({
      meta_message_id: `b${n}`, text: null, kind: "reply", created_at: "2026-11-01T07:00:00Z",
    }));
    expect(decideAutoReply(decideInput({ botSends }))).toEqual({ action: "skip", reason: "cap" });
  });
  it("only fresh inbound text or photo rows are candidates", () => {
    expect(isBotCandidate({ direction: "in", unsupported: false, text: "hi", attachments: [] })).toBe(true);
    expect(isBotCandidate({ direction: "in", unsupported: false, text: null, attachments: [{ type: "image", url: null }] })).toBe(true);
    expect(isBotCandidate({ direction: "out", unsupported: false, text: "hi", attachments: [] })).toBe(false);
    expect(isBotCandidate({ direction: "in", unsupported: true, text: null, attachments: [] })).toBe(false);
    expect(isBotCandidate({ direction: "in", unsupported: false, text: "  ", attachments: [{ type: "audio", url: null }] })).toBe(false);
  });
});

describe("buildHistory", () => {
  it("maps in → user, out → assistant, marks photos, never ends on assistant", () => {
    const h = buildHistory([
      row({ meta_message_id: "a", text: "გამარჯობა", sent_at: "1" }),
      row({ meta_message_id: "b", direction: "out", text: "გამარჯობა! რით დაგეხმაროთ?", sent_at: "2" }),
      row({ meta_message_id: "c", attachments: [{ type: "image", url: null }], sent_at: "3" }),
      row({ meta_message_id: "d", text: "ფასი?", sent_at: "4" }),
      row({ meta_message_id: "e", direction: "out", text: "late echo", sent_at: "5" }),
    ]);
    expect(h).toEqual([
      { role: "user", content: "გამარჯობა" },
      { role: "assistant", content: "გამარჯობა! რით დაგეხმაროთ?" },
      { role: "user", content: "[ფოტო]" },
      { role: "user", content: "ფასი?" },
    ]);
  });
  it("keeps only the last 8", () => {
    const many = Array.from({ length: 12 }, (_, n) => row({ meta_message_id: `m${n}`, text: `t${n}`, sent_at: String(n) }));
    expect(buildHistory(many).map((t) => t.content)).toEqual(["t4", "t5", "t6", "t7", "t8", "t9", "t10", "t11"]);
  });
});

describe("cleanBotReply", () => {
  const fence = (kind: string, body = '{"a":1}') => "```maika-" + kind + "\n" + body + "\n```";
  it("strips a mockup fence and adds the design link line", () => {
    const out = cleanBotReply(`აი ესკიზი:\n${fence("mockup")}`);
    expect(out).toBe(`აი ესკიზი:\n${DESIGN_LINK_LINE}`);
    expect(out).not.toContain("```");
  });
  it("strips generate / callback / order-status fences; only design ones add the link", () => {
    expect(cleanBotReply(`ok\n${fence("generate")}`)).toBe(`ok\n${DESIGN_LINK_LINE}`);
    expect(cleanBotReply(`მადლობა\n${fence("callback")}`)).toBe("მადლობა");
    expect(cleanBotReply(`შევამოწმებ\n${fence("order-status")}`)).toBe("შევამოწმებ");
  });
  it("strips an unterminated fence", () => {
    expect(cleanBotReply("ტექსტი\n```maika-mockup\n{\"a\":")).toBe(`ტექსტი\n${DESIGN_LINK_LINE}`);
  });
  it("does not add the link twice", () => {
    const out = cleanBotReply(`ნახეთ https://maika.ge/chat\n${fence("mockup")}`);
    expect(out).toBe("ნახეთ https://maika.ge/chat");
  });
  it("removes markdown a DM cannot render", () => {
    expect(cleanBotReply("**ფასი:** 25₾\n[საიტი](https://maika.ge)")).toBe("ფასი: 25₾\nსაიტი: https://maika.ge");
  });
  it("caps the length", () => {
    const long = "ა".repeat(3000);
    const out = cleanBotReply(long);
    expect(Array.from(out).length).toBeLessThanOrEqual(MAX_REPLY_CHARS);
    expect(out.endsWith("…")).toBe(true);
  });
  it("never returns an empty message", () => {
    expect(cleanBotReply(fence("callback")).length).toBeGreaterThan(10);
  });
  it("leaves the bank-account fix (applied by the proxy) intact", () => {
    expect(cleanBotReply("ანგარიში: GE13TB7099236020100012")).toBe("ანგარიში: GE13TB7099236020100012");
  });
});

describe("splitForChannel", () => {
  it("Messenger: one message", () => {
    expect(splitForChannel("ა".repeat(900), "messenger")).toHaveLength(1);
  });
  it("Instagram: chunks of at most 1000 UTF-8 bytes", () => {
    const text = Array.from({ length: 30 }, (_, n) => `ხაზი ნომერი ${n} — მაისურის ფასი`).join("\n");
    const parts = splitForChannel(text, "instagram");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(IG_MAX_BYTES);
    expect(parts.join("\n").replace(/\s+/g, "")).toBe(text.replace(/\s+/g, ""));
  });
  it("Instagram: short text unchanged", () => {
    expect(splitForChannel("გამარჯობა", "instagram")).toEqual(["გამარჯობა"]);
  });
});

// ── orchestration with fakes ───────────────────────────────────────────────

function fakeDeps(o: Partial<AutoReplyDeps> & { thread?: ThreadRow[] } = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const sent: { channel: string; to: string; text: string }[] = [];
  const records: { id: string; kind: string; text: string; mid?: string }[] = [];
  const thread = o.thread ?? [row({ meta_message_id: "m1", text: "რა ღირს მაისური?", sent_at: "2026-11-01T08:00:00.000Z" })];
  const deps: AutoReplyDeps = {
    now: () => SUNDAY_NOON,
    sleep: async () => { calls.push("sleep"); },
    tokenSet: true,
    loadSettings: async () => { calls.push("settings"); return { enabled: true, schedule: "sunday" }; },
    isHandedOff: async () => { calls.push("handoff?"); return false; },
    insertHandoff: async () => { calls.push("handoff!"); },
    loadThread: async () => { calls.push("thread"); return thread; },
    loadOutRows: async () => [],
    loadBotSends: async () => [],
    recordSend: async (_k, kind, text) => { const id = `r${records.length}`; records.push({ id, kind, text }); calls.push("record"); return id; },
    markSent: async (id, mid) => { const r = records.find((x) => x.id === id); if (r) r.mid = mid; calls.push("mark"); },
    askBot: async () => { calls.push("ask"); return "მაისური 25₾-დან.\n```maika-mockup\n{}\n```"; },
    send: async (channel, to, text) => { calls.push("send"); sent.push({ channel, to, text }); return { ok: true, messageId: `mid${sent.length}` }; },
    log: (_l, m) => { logs.push(m); },
    ...o,
  };
  return { deps, calls, logs, sent, records };
}

const trigger: TriggerRow = {
  channel: "messenger", page_id: "159657880717306", customer_id: "psid1",
  meta_message_id: "m1", text: "რა ღირს მაისური?", sent_at: "2026-11-01T08:00:00.000Z",
};

describe("runAutoReply", () => {
  beforeEach(() => _resetTokenWarning());

  it("disabled: one settings read, nothing else", async () => {
    const f = fakeDeps({ loadSettings: async () => ({ enabled: false, schedule: "sunday" }) });
    expect(await runAutoReply(trigger, f.deps)).toBe("disabled");
    expect(f.calls).toEqual([]);
    expect(f.sent).toEqual([]);
  });

  it("missing token: logs once by name, sends nothing", async () => {
    const f = fakeDeps({ tokenSet: false });
    expect(await runAutoReply(trigger, f.deps)).toBe("no_token");
    expect(await runAutoReply(trigger, f.deps)).toBe("no_token");
    expect(f.logs.filter((l) => l.includes("META_PAGE_TOKEN"))).toHaveLength(1);
    expect(f.sent).toEqual([]);
  });

  it("AI reply: records before sending, strips the fence, writes the mid back", async () => {
    const f = fakeDeps();
    expect(await runAutoReply(trigger, f.deps)).toBe("reply");
    expect(f.calls.indexOf("record")).toBeLessThan(f.calls.indexOf("send"));
    expect(f.sent).toEqual([{ channel: "messenger", to: "psid1", text: `მაისური 25₾-დან.\n${DESIGN_LINK_LINE}` }]);
    expect(f.records[0]).toMatchObject({ kind: "reply", mid: "mid1" });
  });

  it("handoff: inserts the row and sends the fixed message, no AI call", async () => {
    const f = fakeDeps({ thread: [row({ meta_message_id: "m1", text: "ოპერატორი მინდა", sent_at: trigger.sent_at })] });
    expect(await runAutoReply({ ...trigger, text: "ოპერატორი მინდა" }, f.deps)).toBe("handoff");
    expect(f.calls).toContain("handoff!");
    expect(f.calls).not.toContain("ask");
    expect(f.sent[0].text).toBe(handoffMessage("sunday"));
  });

  it("handed-off conversation: silent", async () => {
    const f = fakeDeps({ isHandedOff: async () => true });
    expect(await runAutoReply(trigger, f.deps)).toBe("handed_off");
    expect(f.sent).toEqual([]);
  });

  it("photo: fixed acknowledgement, no AI on the image", async () => {
    const f = fakeDeps({ thread: [row({ meta_message_id: "m1", attachments: [{ type: "image", url: "u" }], sent_at: trigger.sent_at })] });
    expect(await runAutoReply({ ...trigger, text: null }, f.deps)).toBe("photo");
    expect(f.calls).not.toContain("ask");
    expect(f.sent[0].text).toContain("https://maika.ge/chat");
  });

  it("send failure is logged by status and code, never crashes", async () => {
    const f = fakeDeps({ send: async () => ({ ok: false, status: 400, code: "10/2018278/OAuthException" }) });
    expect(await runAutoReply(trigger, f.deps)).toBe("send_failed");
    expect(f.logs.some((l) => l.includes("status=400") && l.includes("code=10/2018278"))).toBe(true);
  });

  it("an exception anywhere is swallowed and scrubbed", async () => {
    const f = fakeDeps({ askBot: async () => { throw new Error("boom https://x/?access_token=EAAsecret"); } });
    expect(await runAutoReply(trigger, f.deps)).toBe("error");
    expect(f.logs.join(" ")).not.toContain("EAAsecret");
    expect(scrubSecrets("Bearer EAAabc.def")).toBe("Bearer ***");
  });

  it("no record → no send", async () => {
    const f = fakeDeps({ recordSend: async () => null });
    expect(await runAutoReply(trigger, f.deps)).toBe("record_failed");
    expect(f.sent).toEqual([]);
  });
});

// ── gemini-proxy social channel ────────────────────────────────────────────

describe("gemini-proxy social channel", () => {
  const KEY = "service-role-key-not-real";
  it("is trusted only with the service-role bearer, a known channel and faq-chat", () => {
    expect(resolveTrustedSocialChannel("faq-chat", "messenger", `Bearer ${KEY}`, KEY)).toBe("messenger");
    expect(resolveTrustedSocialChannel("faq-chat", "instagram", `Bearer ${KEY}`, KEY)).toBe("instagram");
    expect(resolveTrustedSocialChannel("faq-chat", undefined, `Bearer ${KEY}`, KEY)).toBeNull();
    expect(resolveTrustedSocialChannel("faq-chat", "messenger", "Bearer anon-key", KEY)).toBeNull();
    expect(resolveTrustedSocialChannel("faq-chat", "messenger", null, KEY)).toBeNull();
    expect(resolveTrustedSocialChannel("faq-chat", "messenger", `Bearer ${KEY}`, "")).toBeNull();
    expect(resolveTrustedSocialChannel("faq-chat", "whatsapp", `Bearer ${KEY}`, KEY)).toBeNull();
    expect(resolveTrustedSocialChannel("generate-design", "messenger", `Bearer ${KEY}`, KEY)).toBeNull();
  });

  it("without a channel the system prompt is byte-identical", () => {
    const content = "KB TEXT\n\nSTOCK\n\nCALLER: guest";
    expect(withSocialBlock(content, null)).toBe(content);
  });

  it("with a channel the block goes before CALLER, which stays last", () => {
    const content = "KB TEXT\n\nCALLER: guest";
    const out = withSocialBlock(content, "messenger", "sunday");
    expect(out.startsWith("KB TEXT\n\n")).toBe(true);
    expect(out.endsWith("\n\nCALLER: guest")).toBe(true);
    expect(out).toContain("You are answering in Facebook Messenger on behalf of maika.ge");
    expect(out).toContain("operators are off (Sunday)");
    expect(out).toContain("https://maika.ge/chat");
    expect(out).toContain("„ოპერატორი\"");
    expect(socialPromptBlock("instagram", "sunday")).toContain("answering in Instagram");
    expect(socialPromptBlock("messenger", "off_hours")).toContain("during working hours");
  });

  const SRC = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");

  it("website path in index.ts: same system turn, social block only behind the trusted channel", () => {
    // The original system turn is still built exactly as before …
    expect(SRC).toContain("messages = [{ role: \"system\", content: `${faqKb}${stockBlock}\\n\\nCALLER: ${caller}` }, ...history];");
    // … and is only rewritten inside `if (faqSocialChannel)`.
    const i = SRC.indexOf("withSocialBlock(messages[0].content");
    expect(i).toBeGreaterThan(-1);
    expect(SRC.lastIndexOf("if (faqSocialChannel) {", i)).toBeGreaterThan(SRC.indexOf("${faqKb}${stockBlock}"));
    // The faq-chat limiter only skips for admins and the trusted channel.
    expect(SRC).toContain("if (!isAdmin && !faqSocialChannel) {");
    // The trusted channel is derived from the request, never set elsewhere.
    expect(SRC.match(/faqSocialChannel = /g)).toHaveLength(1);
    expect(SRC).toContain("let faqSocialChannel: SocialChannel | null = null;");
  });

  it("chat_logs still uses params.session_id (the webhook sends conversation_key there)", () => {
    expect(SRC).toContain("const sessionId = typeof params.session_id === \"string\" ? params.session_id : null;");
  });
});

describe("Meta automation echoes are not a human takeover", () => {
  it("instant reply / away message do not silence the bot", async () => {
    const { humanTookOver, isMetaAutomationEcho } = await import("../../supabase/functions/meta-webhook/botReply");
    const now = new Date("2026-11-01T10:00:00Z");
    const rows = [
      { meta_message_id: "m1", text: "გამარჯობა, maika.ge-ის გუნდი მალე გიპასუხებთ.", sent_at: "2026-11-01T09:59:00Z" },
      { meta_message_id: "m2", text: "მოგესალმებით! 👋\nთქვენ დაგვიკავშირდით არასამუშაო დროს. ოპერატორი უახლოეს სამუშაო საათებში გიპასუხებთ.", sent_at: "2026-11-01T09:59:01Z" },
    ];
    expect(isMetaAutomationEcho(rows[0].text)).toBe(true);
    expect(humanTookOver(rows, [], now)).toBe(false);
    expect(humanTookOver([...rows, { meta_message_id: "m3", text: "ჰუდი 80 ლარია", sent_at: "2026-11-01T09:59:30Z" }], [], now)).toBe(true);
  });
});

describe("away-message echo after the customer's message", () => {
  it("still leaves the customer's message pending and out of history", async () => {
    const { pendingInbound, buildHistory } = await import("../../supabase/functions/meta-webhook/botReply");
    const thread = [
      { meta_message_id: "a", direction: "in" as const, text: "რა ღირს ჰუდი?", attachments: null, unsupported: false, sent_at: "2026-10-31T14:33:40Z" },
      { meta_message_id: "b", direction: "out" as const, text: "მოგესალმებით! 👋\nთქვენ დაგვიკავშირდით არასამუშაო დროს.", attachments: null, unsupported: false, sent_at: "2026-10-31T14:33:43Z" },
    ];
    expect(pendingInbound(thread).map((r) => r.meta_message_id)).toEqual(["a"]);
    expect(buildHistory(thread)).toEqual([{ role: "user", content: "რა ღირს ჰუდი?" }]);
  });
});
