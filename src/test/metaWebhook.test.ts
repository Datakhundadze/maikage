// @vitest-environment node
//
// Drives the REAL meta-webhook handler (supabase/functions/meta-webhook/
// handler.ts) in Node with signed requests and an in-memory store that
// enforces the table's UNIQUE (meta_message_id) with ON CONFLICT DO NOTHING
// semantics. Nothing here touches Meta or Supabase.
//
// Payload shapes follow Meta's documented Messenger Platform / Instagram
// Messaging webhook formats. Fields whose exact spelling could not be checked
// against the live docs from this environment are marked UNVERIFIED inline.

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  computeMetaSignature,
  handleMetaWebhook,
  parseDelivery,
  timingSafeEqualHex,
  type SocialMessageRow,
} from "../../supabase/functions/meta-webhook/handler";

const APP_SECRET = "test-app-secret-not-real";
const VERIFY_TOKEN = "test-verify-token-not-real";
const URL_BASE = "https://example.test/functions/v1/meta-webhook";

/** In-memory social_messages with the UNIQUE constraint and DO NOTHING. */
function makeStore() {
  const rows = new Map<string, SocialMessageRow>();
  let failNext: string | null = null;
  return {
    rows,
    failNext: (msg: string) => { failNext = msg; },
    store: async (batch: SocialMessageRow[]) => {
      if (failNext) { const e = failNext; failNext = null; return { inserted: 0, error: e }; }
      let inserted = 0;
      for (const r of batch) {
        if (rows.has(r.meta_message_id)) continue; // ON CONFLICT DO NOTHING
        rows.set(r.meta_message_id, r);
        inserted += 1;
      }
      return { inserted, error: null };
    },
  };
}

const logs: string[] = [];
const deps = (s: ReturnType<typeof makeStore>, over: Partial<{ appSecret: string; verifyToken: string }> = {}) => ({
  appSecret: APP_SECRET,
  verifyToken: VERIFY_TOKEN,
  store: s.store,
  log: (level: string, msg: string) => { logs.push(`${level}: ${msg}`); },
  ...over,
});

async function signedPost(body: unknown, opts: { secret?: string; signature?: string | null; rawOverride?: string } = {}) {
  const raw = opts.rawOverride ?? JSON.stringify(body);
  const bytes = new TextEncoder().encode(raw);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.signature !== null) {
    headers["x-hub-signature-256"] = opts.signature ?? (await computeMetaSignature(opts.secret ?? APP_SECRET, bytes));
  }
  return new Request(URL_BASE, { method: "POST", headers, body: raw });
}

// ── documented payload shapes ─────────────────────────────────────────────

const PAGE_ID = "1234567890";
const PSID = "2222222222222222";
const IG_ID = "17841400000000000";
const IGSID = "5555555555555555";

/** Messenger: a customer text message. */
const messengerText = (mid = "m_AbCdEf123") => ({
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: 1758600000000,
    messaging: [{
      sender: { id: PSID },
      recipient: { id: PAGE_ID },
      timestamp: 1758600000000,
      message: { mid, text: "გამარჯობა, ჩემი ნომერია 577 12 34 56, როდის მოვა შეკვეთა?" },
    }],
  }],
});

/** Messenger: the page's own reply, delivered back as an echo. */
const messengerEcho = (mid = "m_Echo987") => ({
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: 1758600300000,
    messaging: [{
      sender: { id: PAGE_ID },
      recipient: { id: PSID },
      timestamp: 1758600300000,
      message: { is_echo: true, app_id: 123456789, metadata: "", mid, text: "დღეს გამოგიგზავნით 🙂" },
    }],
  }],
});

/** Instagram: a customer DM with a photo. `object: "instagram"` and
 *  entry[].id = the IG professional account id. Attachment payload.url shape
 *  matches Messenger's; the exact set of Instagram attachment `type` values
 *  (image / video / audio / file / share / story_mention / ig_reel …) is
 *  UNVERIFIED and stored verbatim whatever it is. */
const instagramPhoto = (mid = "m_IgAbc123") => ({
  object: "instagram",
  entry: [{
    id: IG_ID,
    time: 1758600600000,
    messaging: [{
      sender: { id: IGSID },
      recipient: { id: IG_ID },
      timestamp: 1758600600000,
      message: {
        mid,
        attachments: [{ type: "image", payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc" } }],
      },
    }],
  }],
});

beforeEach(() => { logs.length = 0; });

describe("meta-webhook — GET subscription check", () => {
  it("(a) echoes hub.challenge with the right verify token", async () => {
    const s = makeStore();
    const req = new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(VERIFY_TOKEN)}&hub.challenge=1158201444`);
    const res = await handleMetaWebhook(req, deps(s));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
    expect(res.headers.get("content-type")).toContain("text/plain");
  });

  it("(b) refuses a wrong token, a missing token and a wrong mode with 403", async () => {
    const s = makeStore();
    for (const q of [
      "hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1",
      "hub.mode=subscribe&hub.challenge=1",
      "hub.mode=unsubscribe&hub.verify_token=" + encodeURIComponent(VERIFY_TOKEN) + "&hub.challenge=1",
    ]) {
      const res = await handleMetaWebhook(new Request(`${URL_BASE}?${q}`), deps(s));
      expect(res.status).toBe(403);
    }
    // An unset verify token can never match, even an empty one.
    const res = await handleMetaWebhook(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`), deps(s, { verifyToken: "" }));
    expect(res.status).toBe(403);
  });
});

describe("meta-webhook — POST deliveries", () => {
  it("(c) a signed Messenger text → one row, direction 'in', PII redacted", async () => {
    const s = makeStore();
    const res = await handleMetaWebhook(await signedPost(messengerText()), deps(s));
    expect(res.status).toBe(200);
    expect(s.rows.size).toBe(1);
    const row = s.rows.get("m_AbCdEf123")!;
    expect(row).toMatchObject({
      channel: "messenger",
      page_id: PAGE_ID,
      customer_id: PSID,
      sender_id: PSID,
      direction: "in",
      unsupported: false,
      attachments: [],
      sent_at: new Date(1758600000000).toISOString(),
    });
    expect(row.text).toBe("გამარჯობა, ჩემი ნომერია [phone:***56], როდის მოვა შეკვეთა?");
  });

  it("(d) the same delivery again → still one row (Meta retry is idempotent)", async () => {
    const s = makeStore();
    expect((await handleMetaWebhook(await signedPost(messengerText()), deps(s))).status).toBe(200);
    expect((await handleMetaWebhook(await signedPost(messengerText()), deps(s))).status).toBe(200);
    expect(s.rows.size).toBe(1);
    expect(logs.at(-1)).toContain("stored 0/1");
  });

  it("(e) an echo → direction 'out', customer is the recipient", async () => {
    const s = makeStore();
    const res = await handleMetaWebhook(await signedPost(messengerEcho()), deps(s));
    expect(res.status).toBe(200);
    const row = s.rows.get("m_Echo987")!;
    expect(row).toMatchObject({
      channel: "messenger",
      page_id: PAGE_ID,
      customer_id: PSID,
      sender_id: PAGE_ID,
      direction: "out",
      text: "დღეს გამოგიგზავნით 🙂",
    });
  });

  it("(f) an Instagram payload → channel 'instagram', attachment type + url kept", async () => {
    const s = makeStore();
    const res = await handleMetaWebhook(await signedPost(instagramPhoto()), deps(s));
    expect(res.status).toBe(200);
    const row = s.rows.get("m_IgAbc123")!;
    expect(row).toMatchObject({
      channel: "instagram",
      page_id: IG_ID,
      customer_id: IGSID,
      direction: "in",
      text: null,
      attachments: [{ type: "image", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc" }],
    });
  });

  it("(g) a bad, missing, wrong-secret or tampered signature → 401, zero rows", async () => {
    const s = makeStore();
    const cases = [
      await signedPost(messengerText(), { signature: null }),
      await signedPost(messengerText(), { signature: "sha256=" + "0".repeat(64) }),
      await signedPost(messengerText(), { signature: "sha1=deadbeef" }),
      await signedPost(messengerText(), { secret: "some-other-secret" }),
    ];
    // Valid signature over different bytes (body tampered after signing).
    const good = await computeMetaSignature(APP_SECRET, new TextEncoder().encode(JSON.stringify(messengerText())));
    cases.push(await signedPost(messengerText("m_Tampered"), { signature: good }));
    for (const req of cases) {
      const res = await handleMetaWebhook(req, deps(s));
      expect(res.status).toBe(401);
    }
    // And with no secret configured on the server, a delivery signed with
    // ANY key is refused (the handler never derives a key from "").
    expect((await handleMetaWebhook(await signedPost(messengerText(), { secret: "attacker-guess" }), deps(s, { appSecret: "" }))).status).toBe(401);
    expect(s.rows.size).toBe(0);
  });

  it("(h) a batch with one malformed event → the others stored, 200", async () => {
    const s = makeStore();
    const batch = {
      object: "page",
      entry: [{
        id: PAGE_ID,
        time: 1758600000000,
        messaging: [
          messengerText("m_1").entry[0].messaging[0],
          { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1758600001000, message: { text: "no mid on this one" } },
          "not even an object",
          { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1758600002000, read: { watermark: 1758600001000 } },
          { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1758600003000, reaction: { mid: "m_1", action: "react", emoji: "❤️" } },
          { sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: 1758600004000, message: { mid: "m_del", is_deleted: true } },
          messengerEcho("m_2").entry[0].messaging[0],
        ],
      }],
    };
    const res = await handleMetaWebhook(await signedPost(batch), deps(s));
    expect(res.status).toBe(200);
    expect([...s.rows.keys()].sort()).toEqual(["m_1", "m_2"]);
    expect(logs.some((l) => l.includes("malformed=2") && l.includes("read=1") && l.includes("reaction=1") && l.includes("is_deleted=1"))).toBe(true);
  });

  it("signed-but-not-JSON and non-message objects → 200, nothing stored", async () => {
    const s = makeStore();
    expect((await handleMetaWebhook(await signedPost(null, { rawOverride: "not json {" }), deps(s))).status).toBe(200);
    expect((await handleMetaWebhook(await signedPost({ object: "user", entry: [] }), deps(s))).status).toBe(200);
    // Instagram comment/mention events arrive under entry[].changes — not DMs.
    expect((await handleMetaWebhook(await signedPost({ object: "instagram", entry: [{ id: IG_ID, time: 1, changes: [{ field: "comments", value: {} }] }] }), deps(s))).status).toBe(200);
    expect(s.rows.size).toBe(0);
  });

  it("a store failure → 500 so Meta retries; a later success writes the rows", async () => {
    const s = makeStore();
    s.failNext("connection refused");
    expect((await handleMetaWebhook(await signedPost(messengerText()), deps(s))).status).toBe(500);
    expect(s.rows.size).toBe(0);
    expect((await handleMetaWebhook(await signedPost(messengerText()), deps(s))).status).toBe(200);
    expect(s.rows.size).toBe(1);
  });

  it("other methods → 405", async () => {
    const s = makeStore();
    expect((await handleMetaWebhook(new Request(URL_BASE, { method: "PUT" }), deps(s))).status).toBe(405);
  });
});

describe("meta-webhook — parsing details", () => {
  it("an Instagram is_unsupported message keeps the turn with no content", () => {
    const out = parseDelivery({
      object: "instagram",
      entry: [{ id: IG_ID, time: 1, messaging: [{ sender: { id: IGSID }, recipient: { id: IG_ID }, timestamp: 1758600000000, message: { mid: "m_u", is_unsupported: true } }] }],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ unsupported: true, text: null, attachments: [] });
  });

  it("two events with the same mid in one delivery keep the first", () => {
    const ev = messengerText("m_dup").entry[0].messaging[0];
    const out = parseDelivery({ object: "page", entry: [{ id: PAGE_ID, time: 1, messaging: [ev, ev] }] });
    expect(out.rows).toHaveLength(1);
  });

  it("emails in a DM are redacted like phones", () => {
    const ev = { ...messengerText("m_e").entry[0].messaging[0], message: { mid: "m_e", text: "write to giorgi.k@gmail.com" } };
    const out = parseDelivery({ object: "page", entry: [{ id: PAGE_ID, time: 1, messaging: [ev] }] });
    expect(out.rows[0].text).toBe("write to [email:g***@gmail.com]");
  });

  it("timingSafeEqualHex compares whole strings", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
    expect(timingSafeEqualHex("abc", "ab")).toBe(false);
  });
});

describe("meta-webhook — redactPii copy stays identical to gemini-proxy's", () => {
  it("the body below the provenance header is byte-for-byte the original", () => {
    const root = path.resolve(__dirname, "../../supabase/functions");
    const original = readFileSync(path.join(root, "gemini-proxy/redactPii.ts"), "utf8");
    const copy = readFileSync(path.join(root, "meta-webhook/redactPii.ts"), "utf8");
    expect(copy.endsWith(original)).toBe(true);
    expect(copy.startsWith("// ⚠️ COPY of supabase/functions/gemini-proxy/redactPii.ts")).toBe(true);
  });
});
