// @vitest-environment node
//
// WhatsApp Cloud API path of meta-webhook (add-only, 2026-11-02): the parser
// (whatsapp.ts), the delivery routing in handler.ts, and the send / media /
// masking helpers (whatsappSend.ts). Nothing here touches Meta or Supabase.
//
// Payloads follow Meta's documented WhatsApp Cloud API webhook formats. The
// smb_message_echoes array name (`message_echoes`) is UNVERIFIED offline; the
// parser also accepts `messages` there.

import { describe, it, expect } from "vitest";
import {
  computeMetaSignature,
  handleMetaWebhook,
  type SocialMessageRow,
} from "../../supabase/functions/meta-webhook/handler";
import {
  WA_PLACEHOLDERS,
  parseWhatsAppDelivery,
  proxyChannelFor,
  waBotOutRow,
  type WaStoreExtras,
} from "../../supabase/functions/meta-webhook/whatsapp";
import {
  WA_ALLOWLIST_REQUIRED,
  WA_MAX_TEXT,
  downloadWaMedia,
  isMetaMediaHost,
  maskPhone,
  postWhatsApp,
  scrubWaLog,
  strictAllowKeys,
  waImageBody,
  waMayMarkRead,
  waMediaUrl,
  waMessagesUrl,
  waReadBody,
  waTextBody,
  withinReplyWindow,
  type FetchLike,
} from "../../supabase/functions/meta-webhook/whatsappSend";
import { conversationKeyOf } from "../../supabase/functions/meta-webhook/autoReply";
import { isBotCandidate } from "../../supabase/functions/meta-webhook/botReply";
import { mirrorTargets } from "../../supabase/functions/meta-webhook/media";

const APP_SECRET = "test-app-secret-not-real";
const VERIFY_TOKEN = "test-verify-token-not-real";
const URL_BASE = "https://example.test/functions/v1/meta-webhook";

const WABA_ID = "102000000000001";
const PHONE_NUMBER_ID = "106540352242922";
const DISPLAY = "995599050807";
const WA_ID = "995577123456";
const TS = "1762084800"; // 2025-11-02T12:00:00Z, epoch SECONDS as WhatsApp sends it

const value = (extra: Record<string, unknown>) => ({
  messaging_product: "whatsapp",
  metadata: { display_phone_number: DISPLAY, phone_number_id: PHONE_NUMBER_ID },
  ...extra,
});
const delivery = (field: string, v: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: WABA_ID, changes: [{ field, value: v }] }],
});
const inbound = (m: Record<string, unknown>) =>
  delivery("messages", value({
    contacts: [{ profile: { name: "ნინო" }, wa_id: WA_ID }],
    messages: [{ from: WA_ID, timestamp: TS, ...m }],
  }));

const textMsg = (id = "wamid.HBgLOTk1NTc3MTIzNDU2FQIAEhgUM0E=", body = "გამარჯობა, რა ღირს მაისური?") =>
  inbound({ id, type: "text", text: { body } });
const imageMsg = inbound({
  id: "wamid.IMG1",
  type: "image",
  image: { id: "1234567890123", mime_type: "image/jpeg", sha256: "x", caption: "ასეთი გინდა" },
});
const echoMsg = delivery("smb_message_echoes", value({
  message_echoes: [{ from: DISPLAY, to: WA_ID, id: "wamid.ECHO1", timestamp: TS, type: "text", text: { body: "დიახ, გვაქვს" } }],
}));
const statusMsg = delivery("messages", value({
  statuses: [
    { id: "wamid.OUT1", status: "delivered", timestamp: TS, recipient_id: WA_ID },
    { id: "wamid.OUT2", status: "failed", timestamp: TS, recipient_id: WA_ID, errors: [{ code: 131047, title: "Re-engagement message" }] },
  ],
}));

async function signed(body: unknown, secret = APP_SECRET): Promise<Request> {
  const raw = JSON.stringify(body);
  const sig = await computeMetaSignature(secret, new TextEncoder().encode(raw));
  return new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
}

function harness() {
  const messengerRows: SocialMessageRow[] = [];
  const waRows: SocialMessageRow[] = [];
  const waExtras: WaStoreExtras[] = [];
  const logs: string[] = [];
  return {
    messengerRows, waRows, waExtras, logs,
    deps: {
      appSecret: APP_SECRET,
      verifyToken: VERIFY_TOKEN,
      store: async (rows: SocialMessageRow[]) => { messengerRows.push(...rows); return { inserted: rows.length, error: null }; },
      log: (level: string, msg: string) => { logs.push(`${level}: ${msg}`); },
      whatsapp: {
        store: async (rows: SocialMessageRow[], extras: WaStoreExtras) => {
          waRows.push(...rows);
          waExtras.push(extras);
          return { inserted: rows.length, error: null };
        },
      },
    },
  };
}

// ── parsing ────────────────────────────────────────────────────────────────

describe("parseWhatsAppDelivery", () => {
  it("text → an inbound whatsapp row keyed by phone_number_id + wa_id", () => {
    const p = parseWhatsAppDelivery(textMsg());
    expect(p.malformed).toBe(0);
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0];
    expect(r).toMatchObject({
      channel: "whatsapp",
      page_id: PHONE_NUMBER_ID,
      customer_id: WA_ID,
      sender_id: WA_ID,
      direction: "in",
      text: "გამარჯობა, რა ღირს მაისური?",
      attachments: [],
      unsupported: false,
      sent_at: "2025-11-02T12:00:00.000Z",
    });
    expect(conversationKeyOf(r)).toBe(`whatsapp:${PHONE_NUMBER_ID}:${WA_ID}`);
    expect(p.botEligible.has(r.meta_message_id)).toBe(true);
    expect(p.profiles.get(WA_ID)).toBe("ნინო");
    expect(isBotCandidate(r)).toBe(true);
  });

  it("redacts a phone in the text but keeps the raw one in memory for the order draft", () => {
    const p = parseWhatsAppDelivery(textMsg("wamid.T2", "ჩემი ნომერია 599 12 34 56"));
    expect(p.rows[0].text).toBe("ჩემი ნომერია [phone:***56]");
    expect(p.contacts.get("wamid.T2")?.phones.length).toBe(1);
  });

  it("image → an image attachment on the Graph media endpoint, caption as text, mirror target", () => {
    const p = parseWhatsAppDelivery(imageMsg);
    const r = p.rows[0];
    expect(r.attachments).toEqual([{ type: "image", url: waMediaUrl("1234567890123") }]);
    expect(r.attachments[0].url).toBe("https://graph.facebook.com/v21.0/1234567890123");
    expect(r.text).toBe("ასეთი გინდა");
    expect(mirrorTargets(r.attachments)).toEqual([0]);
    expect(p.botEligible.has("wamid.IMG1")).toBe(true);
  });

  it("audio / document / sticker / location → Georgian placeholder, never bot-eligible", () => {
    const audio = parseWhatsAppDelivery(inbound({ id: "wamid.A", type: "audio", audio: { id: "55", mime_type: "audio/ogg", voice: true } }));
    expect(audio.rows[0].text).toBe(WA_PLACEHOLDERS.audio);
    expect(audio.rows[0].attachments).toEqual([{ type: "audio", url: waMediaUrl("55") }]);
    expect(audio.botEligible.size).toBe(0);
    const doc = parseWhatsAppDelivery(inbound({ id: "wamid.D", type: "document", document: { id: "66", filename: "logo.pdf", caption: "ლოგო" } }));
    expect(doc.rows[0].text).toBe(`${WA_PLACEHOLDERS.document} ლოგო`);
    expect(doc.rows[0].attachments[0].type).toBe("file");
    expect(mirrorTargets(doc.rows[0].attachments)).toEqual([]);
    const sticker = parseWhatsAppDelivery(inbound({ id: "wamid.S", type: "sticker", sticker: { id: "77", mime_type: "image/webp" } }));
    expect(sticker.rows[0].text).toBe(WA_PLACEHOLDERS.sticker);
    expect(sticker.botEligible.size).toBe(0);
    const loc = parseWhatsAppDelivery(inbound({ id: "wamid.L", type: "location", location: { latitude: 41.7, longitude: 44.8, name: "მაიკა" } }));
    expect(loc.rows[0].text).toBe("[მდებარეობა] მაიკა https://maps.google.com/?q=41.7,44.8");
  });

  it("button / interactive replies are stored as their title and may trigger the bot", () => {
    const b = parseWhatsAppDelivery(inbound({ id: "wamid.B", type: "button", button: { text: "კი", payload: "yes" } }));
    expect(b.rows[0].text).toBe("კი");
    const i = parseWhatsAppDelivery(inbound({ id: "wamid.I", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x", title: "ჰუდი" } } }));
    expect(i.rows[0].text).toBe("ჰუდი");
    expect(i.botEligible.has("wamid.I")).toBe(true);
  });

  it("reaction is ignored, unsupported is flagged", () => {
    const r = parseWhatsAppDelivery(inbound({ id: "wamid.R", type: "reaction", reaction: { message_id: "wamid.X", emoji: "👍" } }));
    expect(r.rows).toHaveLength(0);
    expect(r.ignored).toEqual({ reaction: 1 });
    const u = parseWhatsAppDelivery(inbound({ id: "wamid.U", type: "unsupported", errors: [{ code: 131051 }] }));
    expect(u.rows[0]).toMatchObject({ unsupported: true, text: null });
    expect(isBotCandidate(u.rows[0])).toBe(false);
  });

  it("smb_message_echoes → an OUT row of the same conversation (operator on the phone)", () => {
    const p = parseWhatsAppDelivery(echoMsg);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      channel: "whatsapp",
      page_id: PHONE_NUMBER_ID,
      customer_id: WA_ID,
      sender_id: PHONE_NUMBER_ID,
      direction: "out",
      text: "დიახ, გვაქვს",
    });
    expect(conversationKeyOf(p.rows[0])).toBe(`whatsapp:${PHONE_NUMBER_ID}:${WA_ID}`);
    expect(p.botEligible.size).toBe(0);
    // Fallback array name.
    const alt = parseWhatsAppDelivery(delivery("smb_message_echoes", value({
      messages: [{ from: DISPLAY, to: WA_ID, id: "wamid.ECHO2", timestamp: TS, type: "text", text: { body: "ok" } }],
    })));
    expect(alt.rows[0].direction).toBe("out");
  });

  it("statuses are counted, never stored; a failure code becomes a note", () => {
    const p = parseWhatsAppDelivery(statusMsg);
    expect(p.rows).toHaveLength(0);
    expect(p.statuses).toEqual({ delivered: 1, failed: 1 });
    expect(p.notes).toEqual(["status failed code=131047"]);
  });

  it("history / smb_app_state_sync / account_update → compact PII-free notes only", () => {
    const h = parseWhatsAppDelivery(delivery("history", value({
      history: [{ metadata: { phase: 0, chunk_order: 1, progress: 100 }, threads: [{ id: WA_ID, messages: [{}, {}] }, { id: "995500000000", messages: [{}] }] }],
    })));
    expect(h.rows).toHaveLength(0);
    expect(h.notes).toEqual(["history (TODO, not stored): chunks=1 threads=2 messages=3"]);
    const s = parseWhatsAppDelivery(delivery("smb_app_state_sync", value({
      state_sync: [{ type: "contact", contact: { full_name: "X", phone_number: WA_ID }, action: "add" }],
    })));
    expect(s.notes).toEqual(["smb_app_state_sync (TODO, not stored): items=1 [add=1]"]);
    expect(s.notes.join(" ")).not.toContain(WA_ID);
    const a = parseWhatsAppDelivery(delivery("account_update", { event: "PARTNER_ADDED" }));
    expect(a.notes).toEqual(["account_update event=PARTNER_ADDED"]);
  });

  it("bad events are counted as malformed, the rest of the batch survives", () => {
    const body = delivery("messages", value({
      messages: [
        { from: WA_ID, id: "wamid.OK", timestamp: TS, type: "text", text: { body: "hi" } },
        { from: WA_ID, timestamp: TS, type: "text", text: { body: "no id" } },
        { from: WA_ID, id: "wamid.NOTS", type: "text", text: { body: "no ts" } },
      ],
    }));
    const p = parseWhatsAppDelivery(body);
    expect(p.rows.map((r) => r.meta_message_id)).toEqual(["wamid.OK"]);
    expect(p.malformed).toBe(2);
  });
});

// ── routing in handler.ts ─────────────────────────────────────────────────

describe("handleMetaWebhook routes WhatsApp deliveries", () => {
  it("signed WA delivery → whatsapp.store, never the Messenger store", async () => {
    const h = harness();
    const res = await handleMetaWebhook(await signed(textMsg()), h.deps);
    expect(res.status).toBe(200);
    expect(h.waRows).toHaveLength(1);
    expect(h.messengerRows).toHaveLength(0);
    expect(h.waExtras[0].botEligible.size).toBe(1);
    // No phone number or text in any log line.
    expect(h.logs.join("\n")).not.toContain(WA_ID);
    expect(h.logs.join("\n")).not.toContain("გამარჯობა");
  });

  it("bad signature → 401, nothing stored", async () => {
    const h = harness();
    const res = await handleMetaWebhook(await signed(textMsg(), "wrong-secret"), h.deps);
    expect(res.status).toBe(401);
    expect(h.waRows).toHaveLength(0);
  });

  it("store failure → 500 (Meta retries)", async () => {
    const h = harness();
    const deps = { ...h.deps, whatsapp: { store: async () => ({ inserted: 0, error: "check violation" }) } };
    const res = await handleMetaWebhook(await signed(textMsg()), deps);
    expect(res.status).toBe(500);
  });

  it("status-only delivery → 200 without a store call", async () => {
    const h = harness();
    const res = await handleMetaWebhook(await signed(statusMsg), h.deps);
    expect(res.status).toBe(200);
    expect(h.waRows).toHaveLength(0);
  });

  it("without deps.whatsapp a WA delivery is ignored exactly as before", async () => {
    const h = harness();
    const { whatsapp: _unused, ...deps } = h.deps;
    void _unused;
    const res = await handleMetaWebhook(await signed(textMsg()), deps);
    expect(res.status).toBe(200);
    expect(h.waRows).toHaveLength(0);
    expect(h.messengerRows).toHaveLength(0);
  });

  it("a Messenger delivery still goes to the Messenger store with whatsapp deps present", async () => {
    const h = harness();
    const body = {
      object: "page",
      entry: [{ id: "1234567890", time: 1758600000000, messaging: [{ sender: { id: "2222" }, recipient: { id: "1234567890" }, timestamp: 1758600000000, message: { mid: "m_1", text: "hi" } }] }],
    };
    const res = await handleMetaWebhook(await signed(body), h.deps);
    expect(res.status).toBe(200);
    expect(h.messengerRows.map((r) => r.channel)).toEqual(["messenger"]);
    expect(h.waRows).toHaveLength(0);
  });
});

// ── send bodies, HTTP, media ───────────────────────────────────────────────

describe("whatsappSend", () => {
  it("builds the documented text / image / read bodies", () => {
    expect(waMessagesUrl(PHONE_NUMBER_ID)).toBe(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`);
    expect(waTextBody(WA_ID, "გამარჯობა")).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: WA_ID, type: "text",
      text: { body: "გამარჯობა", preview_url: false },
    });
    expect(waImageBody(WA_ID, "https://x.supabase.co/storage/v1/object/public/designs/a.jpg")).toEqual({
      messaging_product: "whatsapp", recipient_type: "individual", to: WA_ID, type: "image",
      image: { link: "https://x.supabase.co/storage/v1/object/public/designs/a.jpg" },
    });
    expect(waReadBody("wamid.X")).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.X" });
  });

  it(`caps a text body at ${WA_MAX_TEXT} characters`, () => {
    const long = "ა ".repeat(3000);
    const body = (waTextBody(WA_ID, long).text as { body: string }).body;
    expect(Array.from(body).length).toBeLessThanOrEqual(WA_MAX_TEXT);
    expect((waTextBody(WA_ID, "short").text as { body: string }).body).toBe("short");
  });

  it("postWhatsApp: token only in the header, wamid back on success, Graph code on error", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const ok: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ input: WA_ID, wa_id: WA_ID }], messages: [{ id: "wamid.SENT" }] }), { status: 200 });
    };
    const r = await postWhatsApp(ok, PHONE_NUMBER_ID, "tok-secret", waTextBody(WA_ID, "hi"));
    expect(r).toEqual({ ok: true, messageId: "wamid.SENT" });
    expect(calls[0].url).not.toContain("tok-secret");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-secret");
    expect(JSON.parse(String(calls[0].init?.body)).to).toBe(WA_ID);

    const bad: FetchLike = async () => new Response(JSON.stringify({ error: { code: 131047, error_subcode: 2494010, type: "OAuthException" } }), { status: 400 });
    expect(await postWhatsApp(bad, PHONE_NUMBER_ID, "t", {})).toEqual({ ok: false, status: 400, code: "131047/2494010/OAuthException" });
    const boom: FetchLike = async () => { throw new TypeError("network"); };
    expect(await postWhatsApp(boom, PHONE_NUMBER_ID, "t", {})).toEqual({ ok: false, status: 0, code: "TypeError" });
    expect(await postWhatsApp(ok, PHONE_NUMBER_ID, "", {})).toEqual({ ok: false, status: 0, code: "no_token" });
  });

  it("downloadWaMedia: media id → url → bytes, both with the Bearer, image only", async () => {
    const seen: string[] = [];
    const fake: FetchLike = async (url, init) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>)?.Authorization ?? ""}`);
      if (url.startsWith("https://graph.facebook.com/")) {
        return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1", mime_type: "image/jpeg", file_size: 3 }), { status: 200 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
    };
    const m = await downloadWaMedia(fake, waMediaUrl("123"), "tok", 1000);
    expect(m?.contentType).toBe("image/jpeg");
    expect(Array.from(m?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(seen).toEqual([
      "https://graph.facebook.com/v21.0/123 Bearer tok",
      "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1 Bearer tok",
    ]);
  });

  it("downloadWaMedia never sends the token to a non-Meta host and refuses non-images / no token", async () => {
    let second = false;
    const evil: FetchLike = async (url) => {
      if (url.startsWith("https://graph.facebook.com/")) return new Response(JSON.stringify({ url: "https://evil.example/x", mime_type: "image/jpeg" }), { status: 200 });
      second = true;
      return new Response("x");
    };
    expect(await downloadWaMedia(evil, waMediaUrl("1"), "tok", 1000)).toBeNull();
    expect(second).toBe(false);
    const audio: FetchLike = async () => new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/a", mime_type: "audio/ogg" }), { status: 200 });
    expect(await downloadWaMedia(audio, waMediaUrl("1"), "tok", 1000)).toBeNull();
    expect(await downloadWaMedia(audio, waMediaUrl("1"), "", 1000)).toBeNull();
    expect(await downloadWaMedia(audio, "https://example.com/1", "tok", 1000)).toBeNull();
    expect(isMetaMediaHost("https://lookaside.fbsbx.com/x")).toBe(true);
    expect(isMetaMediaHost("http://lookaside.fbsbx.com/x")).toBe(false);
    expect(isMetaMediaHost("https://fbsbx.com.evil.example/x")).toBe(false);
  });
});

// ── masking and gating ─────────────────────────────────────────────────────

describe("masking", () => {
  it("maskPhone keeps only the last 3 digits", () => {
    expect(maskPhone("995577123456")).toBe("*********456");
    expect(maskPhone("+995 577 123 456")).toBe("*********456");
    expect(maskPhone("12")).toBe("***");
    expect(maskPhone(null)).toBe("***");
  });

  it("scrubWaLog masks digit runs and wamids", () => {
    const line = scrubWaLog(`photo wamid.HBgLOTk1NTc3MTIzNDU2FQIAEhgUM0E=#0 to 995577123456 via ${PHONE_NUMBER_ID}, 3 photos`);
    expect(line).not.toContain("995577123456");
    expect(line).not.toContain(PHONE_NUMBER_ID);
    expect(line).not.toContain("HBgLOTk1NTc3MTIzNDU2");
    expect(line).toContain("*********456");
    expect(line).toContain("3 photos");
  });
});

describe("bot gating", () => {
  const key = `whatsapp:${PHONE_NUMBER_ID}:${WA_ID}`;
  it("strictAllowKeys: an empty list answers nobody on WhatsApp", () => {
    expect(strictAllowKeys([])).toEqual([WA_ALLOWLIST_REQUIRED]);
    expect(strictAllowKeys(undefined)).toEqual([WA_ALLOWLIST_REQUIRED]);
    expect(strictAllowKeys([key])).toEqual([key]);
    expect(strictAllowKeys([]).includes(key)).toBe(false);
  });

  it("mark-read only when enabled, in schedule and allow-listed", () => {
    const sunday = new Date("2026-11-01T10:00:00Z"); // Sunday in Tbilisi
    const monday = new Date("2026-11-02T10:00:00Z"); // Monday 14:00 Tbilisi = working hours
    const s = { enabled: true, schedule: "sunday", allowKeys: [key] };
    expect(waMayMarkRead(s, key, sunday)).toBe(true);
    expect(waMayMarkRead(s, key, monday)).toBe(false);
    expect(waMayMarkRead({ ...s, enabled: false }, key, sunday)).toBe(false);
    expect(waMayMarkRead({ ...s, allowKeys: [] }, key, sunday)).toBe(false);
    expect(waMayMarkRead(null, key, sunday)).toBe(false);
  });

  it("24 h window: only fresh inbound messages get a reply", () => {
    const now = new Date("2026-11-02T12:00:00Z");
    expect(withinReplyWindow("2026-11-02T11:59:00Z", now)).toBe(true);
    expect(withinReplyWindow("2026-11-01T12:30:00Z", now)).toBe(false);
    expect(withinReplyWindow("nope", now)).toBe(false);
  });

  it("gemini-proxy is asked as a trusted DM channel it already knows", () => {
    expect(proxyChannelFor("whatsapp")).toBe("messenger");
    expect(proxyChannelFor("messenger")).toBe("messenger");
    expect(proxyChannelFor("instagram")).toBe("instagram");
  });

  it("the bot's own send becomes a redacted out row of the same conversation", () => {
    const r = waBotOutRow(PHONE_NUMBER_ID, WA_ID, "wamid.SENT", "დარეკეთ 599 12 34 56", [], new Date("2026-11-02T12:00:00Z"));
    expect(r).toMatchObject({
      channel: "whatsapp", page_id: PHONE_NUMBER_ID, customer_id: WA_ID, sender_id: PHONE_NUMBER_ID,
      direction: "out", meta_message_id: "wamid.SENT", text: "დარეკეთ [phone:***56]",
    });
    expect(conversationKeyOf(r)).toBe(key);
  });
});
