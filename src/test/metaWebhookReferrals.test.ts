// @vitest-environment node
//
// Ad / link referrals in the meta-webhook (supabase/functions/meta-webhook/
// referrals.ts) — pure extraction, plus the handler wiring with an in-memory
// referral store that enforces UNIQUE (conversation_key, ad_id_key,
// occurred_at) with ON CONFLICT DO NOTHING. Nothing here touches Meta or
// Supabase.
//
// Payload shapes follow Meta's messaging_referrals / messages /
// messaging_postbacks (Messenger) and Instagram messaging webhook references.

import { describe, it, expect } from "vitest";
import { computeMetaSignature, handleMetaWebhook, type SocialMessageRow } from "../../supabase/functions/meta-webhook/handler";
import {
  extractReferrals,
  recordReferrals,
  referralConversationKey,
  type SocialAdReferralRow,
} from "../../supabase/functions/meta-webhook/referrals";

const APP_SECRET = "test-app-secret-not-real";
const URL_BASE = "https://example.test/functions/v1/meta-webhook";
const PAGE_ID = "1234567890";
const PSID = "2222222222222222";
const IG_ID = "17841400000000000";
const IGSID = "5555555555555555";
const AD_ID = "120212345678900123";
const TS = 1760950000000;

const adReferral = {
  ref: "summer_tshirts",
  ad_id: AD_ID,
  source: "ADS",
  type: "OPEN_THREAD",
  ads_context_data: {
    ad_title: "ბეჭდვა მაისურზე — 24 საათში",
    photo_url: "https://scontent.xx.fbcdn.net/v/t45/ad.jpg?oh=abc&oe=def",
    post_id: "1234567890_987654321",
  },
};

const messengerAdFirstMessage = {
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: TS,
    messaging: [{
      sender: { id: PSID },
      recipient: { id: PAGE_ID },
      timestamp: TS,
      message: { mid: "m_ad_first", text: "ფასი რა არის?", referral: adReferral },
    }],
  }],
};

const messengerStandaloneReferral = {
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: TS + 1000,
    messaging: [{
      sender: { id: PSID },
      recipient: { id: PAGE_ID },
      timestamp: TS + 1000,
      referral: { ref: "promo_qr_shop", source: "SHORTLINK", type: "OPEN_THREAD" },
    }],
  }],
};

const messengerPostbackReferral = {
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: TS + 2000,
    messaging: [{
      sender: { id: PSID },
      recipient: { id: PAGE_ID },
      timestamp: TS + 2000,
      postback: {
        title: "Get Started",
        payload: "GET_STARTED",
        referral: { ref: "hoodies", ad_id: AD_ID, source: "ADS", type: "OPEN_THREAD" },
      },
    }],
  }],
};

const instagramAdMessage = {
  object: "instagram",
  entry: [{
    id: IG_ID,
    time: TS + 3000,
    messaging: [{
      sender: { id: IGSID },
      recipient: { id: IG_ID },
      timestamp: TS + 3000,
      message: {
        mid: "m_ig_ad",
        text: "გამარჯობა",
        referral: {
          ref: "ig_ad_ref",
          ad_id: "120299999999990001",
          source: "ADS",
          type: "OPEN_THREAD",
          ads_context_data: { ad_title: "Hoodie collection", photo_url: "https://scontent.cdninstagram.com/x.jpg", post_id: "17900000000000000" },
        },
      },
    }],
  }],
};

const instagramLinkReferral = {
  object: "instagram",
  entry: [{
    id: IG_ID,
    time: TS + 4000,
    messaging: [{
      sender: { id: IGSID },
      recipient: { id: IG_ID },
      timestamp: TS + 4000,
      referral: { ref: "bio_link", source: "IGME_SOURCE_LINK", type: "OPEN_THREAD" },
    }],
  }],
};

const plainMessage = {
  object: "page",
  entry: [{ id: PAGE_ID, time: TS, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: TS, message: { mid: "m_plain", text: "გამარჯობა" } }] }],
};

const echoWithReferral = {
  object: "page",
  entry: [{
    id: PAGE_ID,
    time: TS,
    messaging: [{
      sender: { id: PAGE_ID },
      recipient: { id: PSID },
      timestamp: TS,
      message: { is_echo: true, app_id: 1, mid: "m_echo", text: "მოგწერთ", referral: adReferral },
    }],
  }],
};

describe("extractReferrals — documented shapes", () => {
  it("Messenger CTM ad: message.referral with the first message → one ADS row", () => {
    const rows = extractReferrals(messengerAdFirstMessage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "messenger",
      page_id: PAGE_ID,
      customer_id: PSID,
      ad_id: AD_ID,
      source: "ADS",
      type: "OPEN_THREAD",
      ref: "summer_tshirts",
      ad_title: "ბეჭდვა მაისურზე — 24 საათში",
      occurred_at: new Date(TS).toISOString(),
    });
    // ad_id is NOT run through redactPii (it is an 18-digit id).
    expect(rows[0].raw).toMatchObject({ ad_id: AD_ID, ads_context_data: { post_id: "1234567890_987654321" } });
    expect(referralConversationKey(rows[0])).toBe(`messenger:${PAGE_ID}:${PSID}`);
  });

  it("Messenger: referral beside message AND message.referral in one event → collapsed to one row", () => {
    const ev = { ...messengerAdFirstMessage.entry[0].messaging[0], referral: adReferral };
    const rows = extractReferrals({ object: "page", entry: [{ id: PAGE_ID, time: TS, messaging: [ev] }] });
    expect(rows).toHaveLength(1);
  });

  it("Messenger standalone messaging_referrals event (m.me link) → ref-only row", () => {
    const rows = extractReferrals(messengerStandaloneReferral);
    expect(rows).toEqual([expect.objectContaining({
      channel: "messenger",
      page_id: PAGE_ID,
      customer_id: PSID,
      ad_id: null,
      source: "SHORTLINK",
      type: "OPEN_THREAD",
      ref: "promo_qr_shop",
      ad_title: null,
    })]);
  });

  it("Messenger postback.referral → row with ad_id", () => {
    const rows = extractReferrals(messengerPostbackReferral);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ad_id: AD_ID, source: "ADS", ref: "hoodies", customer_id: PSID, occurred_at: new Date(TS + 2000).toISOString() });
  });

  it("Instagram message.referral from an ad → instagram row keyed on the IG account", () => {
    const rows = extractReferrals(instagramAdMessage);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "instagram",
      page_id: IG_ID,
      customer_id: IGSID,
      ad_id: "120299999999990001",
      source: "ADS",
      type: "OPEN_THREAD",
      ad_title: "Hoodie collection",
    });
    expect(referralConversationKey(rows[0])).toBe(`instagram:${IG_ID}:${IGSID}`);
  });

  it("Instagram standalone referral (ig.me link) → row", () => {
    expect(extractReferrals(instagramLinkReferral)).toEqual([expect.objectContaining({ channel: "instagram", ref: "bio_link", ad_id: null })]);
  });

  it("a normal message without referral → no rows", () => {
    expect(extractReferrals(plainMessage)).toEqual([]);
  });

  it("an echo (even carrying a referral) → no rows", () => {
    expect(extractReferrals(echoWithReferral)).toEqual([]);
  });

  it("garbage, unknown objects, missing sender / timestamp → no rows, never throws", () => {
    expect(extractReferrals(null)).toEqual([]);
    expect(extractReferrals("x")).toEqual([]);
    expect(extractReferrals({ object: "user", entry: [] })).toEqual([]);
    expect(extractReferrals({ object: "page", entry: "nope" })).toEqual([]);
    expect(extractReferrals({ object: "page", entry: [{ id: PAGE_ID, messaging: [
      "x",
      { recipient: { id: PAGE_ID }, timestamp: TS, referral: adReferral },
      { sender: { user_ref: "abc" }, recipient: { id: PAGE_ID }, timestamp: TS, referral: adReferral },
      { sender: { id: PSID }, recipient: { id: PAGE_ID }, referral: adReferral },
    ] }] })).toEqual([]);
  });

  it("raw is sanitised: token-like keys dropped, referer_uri query stripped, ad_title redacted", () => {
    const rows = extractReferrals({
      object: "page",
      entry: [{ id: PAGE_ID, time: TS, messaging: [{
        sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: TS,
        referral: {
          source: "ADS", ad_id: AD_ID,
          referer_uri: "https://maika.ge/order?session=abc#x",
          access_token: "EAAB-not-real",
          nested: { page_token: "nope", keep: 1 },
          ads_context_data: { ad_title: "დაგვირეკეთ 577 12 34 56" },
        },
      }] }],
    });
    expect(rows).toHaveLength(1);
    const raw = rows[0].raw as Record<string, unknown>;
    expect(raw.access_token).toBeUndefined();
    expect(raw.nested).toEqual({ keep: 1 });
    expect(raw.referer_uri).toBe("https://maika.ge/order");
    expect(rows[0].ad_title).toBe("დაგვირეკეთ [phone:***56]");
    expect((raw.ads_context_data as Record<string, unknown>).ad_title).toBe("დაგვირეკეთ [phone:***56]");
    expect(JSON.stringify(raw)).not.toContain("EAAB");
  });
});

// ── handler wiring ────────────────────────────────────────────────────────

async function signedPost(body: unknown) {
  const raw = JSON.stringify(body);
  const sig = await computeMetaSignature(APP_SECRET, new TextEncoder().encode(raw));
  return new Request(URL_BASE, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
}

function makeStores() {
  const messages = new Map<string, SocialMessageRow>();
  const referrals = new Map<string, SocialAdReferralRow>();
  const logs: string[] = [];
  let referralError: Error | null = null;
  return {
    messages,
    referrals,
    logs,
    failReferrals: (e: Error) => { referralError = e; },
    deps: {
      appSecret: APP_SECRET,
      verifyToken: "v",
      store: async (rows: SocialMessageRow[]) => {
        let inserted = 0;
        for (const r of rows) if (!messages.has(r.meta_message_id)) { messages.set(r.meta_message_id, r); inserted += 1; }
        return { inserted, error: null };
      },
      storeReferrals: async (rows: SocialAdReferralRow[]) => {
        if (referralError) throw referralError;
        for (const r of rows) {
          const k = `${referralConversationKey(r)}|${r.ad_id ?? ""}|${r.occurred_at}`; // ON CONFLICT DO NOTHING
          if (!referrals.has(k)) referrals.set(k, r);
        }
      },
      log: (level: string, msg: string) => { logs.push(`${level}: ${msg}`); },
    },
  };
}

describe("meta-webhook handler — referrals wiring", () => {
  it("CTM ad first message → message row AND referral row; a retry adds neither", async () => {
    const s = makeStores();
    expect((await handleMetaWebhook(await signedPost(messengerAdFirstMessage), s.deps)).status).toBe(200);
    expect((await handleMetaWebhook(await signedPost(messengerAdFirstMessage), s.deps)).status).toBe(200);
    expect(s.messages.size).toBe(1);
    expect(s.referrals.size).toBe(1);
    // The social_messages row is exactly what it was before this feature.
    expect(s.messages.get("m_ad_first")).toEqual({
      channel: "messenger",
      page_id: PAGE_ID,
      customer_id: PSID,
      meta_message_id: "m_ad_first",
      sender_id: PSID,
      direction: "in",
      text: "ფასი რა არის?",
      attachments: [],
      unsupported: false,
      sent_at: new Date(TS).toISOString(),
    });
  });

  it("standalone referral (no message) is stored and the answer is still 200 'ok'", async () => {
    const s = makeStores();
    const res = await handleMetaWebhook(await signedPost(messengerStandaloneReferral), s.deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(s.messages.size).toBe(0);
    expect(s.referrals.size).toBe(1);
  });

  it("a referral store that throws → logged, messages still stored, 200", async () => {
    const s = makeStores();
    s.failReferrals(new Error("relation social_ad_referrals does not exist"));
    const res = await handleMetaWebhook(await signedPost(instagramAdMessage), s.deps);
    expect(res.status).toBe(200);
    expect(s.messages.size).toBe(1);
    expect(s.referrals.size).toBe(0);
    expect(s.logs.some((l) => l.startsWith("warn: referral record failed"))).toBe(true);
  });

  it("without storeReferrals the handler behaves exactly as before", async () => {
    const s = makeStores();
    const { storeReferrals: _omit, ...legacy } = s.deps;
    void _omit;
    expect((await handleMetaWebhook(await signedPost(messengerAdFirstMessage), legacy)).status).toBe(200);
    expect(s.messages.size).toBe(1);
    expect(s.referrals.size).toBe(0);
  });

  it("recordReferrals never throws, even if the writer rejects synchronously-ish", async () => {
    const logs: string[] = [];
    await expect(recordReferrals(messengerAdFirstMessage, () => { throw new Error("boom"); }, (l, m) => logs.push(`${l}: ${m}`))).resolves.toBeUndefined();
    expect(logs[0]).toContain("boom");
  });
});

describe("extractReferrals — timestamp units", () => {
  it("standalone referral with a SECONDS timestamp (as Meta sends it live) → correct date, not 1970", () => {
    const secs = 1792491291; // 2026-10-20T10:14:51Z, observed in production
    const body = {
      object: "page",
      entry: [{ id: "159657880717306", time: secs * 1000, messaging: [{
        sender: { id: "999" }, recipient: { id: "159657880717306" }, timestamp: secs,
        referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "52663755851724" },
      }] }],
    };
    const rows = extractReferrals(body);
    expect(rows).toHaveLength(1);
    expect(rows[0].occurred_at).toBe("2026-10-20T10:14:51.000Z");
  });
  it("millisecond timestamps are left unchanged", () => {
    const ms = 1792491291228;
    const rows = extractReferrals({ object: "page", entry: [{ id: "p", time: ms, messaging: [{
      sender: { id: "1" }, recipient: { id: "p" }, timestamp: ms,
      referral: { source: "ADS", type: "OPEN_THREAD", ad_id: "1" },
    }] }] });
    expect(rows[0].occurred_at).toBe(new Date(ms).toISOString());
  });
});
