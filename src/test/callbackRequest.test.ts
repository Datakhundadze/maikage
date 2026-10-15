import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// Imported from the edge function itself (plain TypeScript, no Deno APIs at
// module level), so the code under test is the code that runs in production.
import {
  CALLBACK_ADMIN_URL,
  CALLBACK_LOG_MARKER,
  CALLBACK_RECIPIENT,
  type CallbackDeps,
  buildCallbackEmail,
  escapeHtml,
  extractCallbackPhone,
  formatGeorgianPhone,
  handleCallbackRequest,
  hasCallbackBlock,
  normalizeGeorgianPhone,
  sendViaResend,
  stripCallbackBlock,
  tbilisiTime,
} from "../../supabase/functions/gemini-proxy/callbackRequest";

const user = (content: string) => ({ role: "user", content });
const bot = (content: string) => ({ role: "assistant", content });

describe("extractCallbackPhone", () => {
  it("reads a Georgian mobile from the last user turn, as E.164", () => {
    expect(extractCallbackPhone([user("დამირეკეთ 577 12 34 56")])).toBe("+995577123456");
    expect(extractCallbackPhone([user("577123456")])).toBe("+995577123456");
    expect(extractCallbackPhone([user("+995 577-12-34-56 დამირეკეთ")])).toBe("+995577123456");
    expect(extractCallbackPhone([user("00995577123456")])).toBe("+995577123456");
  });

  it("returns null when there is no number", () => {
    expect(extractCallbackPhone([user("დამირეკეთ, გთხოვთ")])).toBeNull();
    expect(extractCallbackPhone([])).toBeNull();
    expect(extractCallbackPhone(undefined)).toBeNull();
    expect(extractCallbackPhone("577123456")).toBeNull();
  });

  it("excludes the shop's own numbers", () => {
    expect(extractCallbackPhone([user("ვრეკავდი 599 05 08 07-ზე")])).toBeNull();
    expect(extractCallbackPhone([user("+995 32 2 05 06 20")])).toBeNull();
    // Own number quoted next to the customer's → the customer's is taken.
    expect(extractCallbackPhone([user("599050807 არ პასუხობს, ჩემია 555 11 22 33")])).toBe("+995555112233");
  });

  it("ignores prices, dates, quantities and non-Georgian numbers", () => {
    expect(extractCallbackPhone([user("2026-10-15 ზე 95 ₾-იანი 20 ცალი")])).toBeNull();
    expect(extractCallbackPhone([user("+44 20 7946 0958")])).toBeNull();
    expect(extractCallbackPhone([user("123456789")])).toBeNull(); // not a Georgian prefix
  });

  it("looks at the last ONE or TWO user turns only, newest first", () => {
    // Number in the previous user turn, consent in the last one.
    expect(extractCallbackPhone([user("ჩემი ნომერია 577 12 34 56"), bot("..."), user("კი, დამირეკეთ")])).toBe("+995577123456");
    // Three user turns back → too old.
    expect(extractCallbackPhone([user("577123456"), user("ა"), user("ბ")])).toBeNull();
    // Newest wins.
    expect(extractCallbackPhone([user("577123456"), user("555112233")])).toBe("+995555112233");
  });

  it("never reads a number from an assistant turn", () => {
    expect(extractCallbackPhone([bot("დაგვირეკეთ 577 12 34 56"), user("კი")])).toBeNull();
  });
});

describe("normalizeGeorgianPhone / formatGeorgianPhone", () => {
  it("normalizes the accepted shapes to 9 national digits", () => {
    expect(normalizeGeorgianPhone("577 12 34 56")).toBe("577123456");
    expect(normalizeGeorgianPhone("995577123456")).toBe("577123456");
    expect(normalizeGeorgianPhone("00995577123456")).toBe("577123456");
    expect(normalizeGeorgianPhone("57712345")).toBeNull();
    expect(normalizeGeorgianPhone("5771234567")).toBeNull();
  });

  it("formats for display", () => {
    expect(formatGeorgianPhone("577123456")).toBe("+995 577 12 34 56");
  });
});

describe("maika-callback block", () => {
  const block = "```maika-callback\n{}\n```";

  it("is detected and stripped (closed fence)", () => {
    const text = `მადლობა! ჩვენი თანამშრომელი დაგიკავშირდებათ სამუშაო საათებში.\n\n${block}`;
    expect(hasCallbackBlock(text)).toBe(true);
    expect(stripCallbackBlock(text)).toBe("მადლობა! ჩვენი თანამშრომელი დაგიკავშირდებათ სამუშაო საათებში.");
  });

  it("is detected and stripped when truncated", () => {
    const text = "მადლობა!\n```maika-callback\n{";
    expect(hasCallbackBlock(text)).toBe(true);
    expect(stripCallbackBlock(text)).toBe("მადლობა!");
  });

  it("strips every copy, and a number put inside it", () => {
    const text = `ა\n${block}\nბ\n\`\`\`maika-callback\n{"phone":"577123456"}\n\`\`\``;
    expect(stripCallbackBlock(text)).toBe("ა\n\nბ");
  });

  it("leaves other text and other fences untouched", () => {
    const text = "ფასი 95 ₾.\n```maika-order-status\n{}\n```";
    expect(hasCallbackBlock(text)).toBe(false);
    expect(stripCallbackBlock(text)).toBe(text);
    expect(hasCallbackBlock("")).toBe(false);
  });

  it("is stateless across calls (global regex)", () => {
    const text = `x\n${block}`;
    expect(hasCallbackBlock(text)).toBe(true);
    expect(hasCallbackBlock(text)).toBe(true);
  });

  it("chat_logs marker", () => {
    expect(CALLBACK_LOG_MARKER).toBe("[ზარის მოთხოვნა]");
  });
});

describe("e-mail", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
    );
  });

  it("builds the subject, tel: link, Tbilisi time, lang, escaped message and admin link", () => {
    const { subject, html } = buildCallbackEmail({
      phone: "+995577123456",
      createdAt: new Date("2026-10-15T10:05:00Z"),
      lang: "ge",
      lastMessage: `დამირეკეთ 577123456 <img src=x onerror="alert(1)">`,
    });
    expect(subject).toBe("📞 დარეკვა: +995 577 12 34 56");
    expect(html).toContain('href="tel:+995577123456"');
    expect(html).toContain("2026-10-15 14:05"); // UTC+4
    expect(html).toContain(">ge<");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain(`href="${CALLBACK_ADMIN_URL}"`);
    expect(CALLBACK_ADMIN_URL).toBe("https://maika.ge/admin?tab=callbacks");
  });

  it("tbilisiTime is UTC+4", () => {
    expect(tbilisiTime(new Date("2026-01-01T21:30:00Z"))).toBe("2026-01-02 01:30");
  });

  it("sendViaResend: no key → error, no request", async () => {
    const fetchFn = vi.fn();
    expect(await sendViaResend(fetchFn as unknown as typeof fetch, undefined, "a@b", { to: "x", subject: "s", html: "h" }))
      .toEqual({ ok: false, error: "RESEND_API_KEY not set" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sendViaResend: posts to Resend; non-2xx and throws become errors", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await sendViaResend(ok as unknown as typeof fetch, "k", "from@x", { to: "maika@maika.ge", subject: "s", html: "h" })).toEqual({ ok: true });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body as string)).toEqual({ from: "from@x", to: ["maika@maika.ge"], subject: "s", html: "h" });

    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect((await sendViaResend(bad as unknown as typeof fetch, "k", "f", { to: "x", subject: "s", html: "h" })).error).toContain("403");
    const boom = vi.fn(async () => { throw new Error("offline"); });
    expect(await sendViaResend(boom as unknown as typeof fetch, "k", "f", { to: "x", subject: "s", html: "h" })).toEqual({ ok: false, error: "offline" });
  });
});

function fakeDeps(over: Partial<CallbackDeps> = {}) {
  const calls: string[] = [];
  const deps: CallbackDeps & { calls: string[] } = {
    calls,
    now: () => new Date("2026-10-15T10:05:00Z"),
    rateLimit: vi.fn(async (key: string) => { calls.push(`rate:${key}`); return true; }),
    recentRequestExists: vi.fn(async () => { calls.push("dedupe"); return false; }),
    insert: vi.fn(async () => { calls.push("insert"); return "row-1"; }),
    update: vi.fn(async () => { calls.push("update"); }),
    sendEmail: vi.fn(async () => { calls.push("email"); return { ok: true }; }),
    log: vi.fn(),
    ...over,
  };
  return deps;
}

const input = (messages: unknown) => ({ messages, sessionId: "s-1", userId: null, lang: "ge", rateKey: "callback:ip:1.2.3.4" });

describe("handleCallbackRequest", () => {
  it("no number → nothing touched", async () => {
    const deps = fakeDeps();
    expect(await handleCallbackRequest(deps, input([user("დამირეკეთ")]))).toBe("no_phone");
    expect(deps.calls).toEqual([]);
  });

  it("happy path: dedupe → rate limit → insert → e-mail → email_sent_at", async () => {
    const deps = fakeDeps();
    expect(await handleCallbackRequest(deps, input([user("კი, 577 12 34 56")]))).toBe("sent");
    expect(deps.calls).toEqual(["dedupe", "rate:callback:ip:1.2.3.4", "insert", "email", "update"]);
    expect(deps.recentRequestExists).toHaveBeenCalledWith("+995577123456", "2026-10-14T10:05:00.000Z");
    const row = (deps.insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(row).toMatchObject({ phone: "+995577123456", session_id: "s-1", user_id: null, lang: "ge" });
    // The note is masked — the raw number lives only in `phone`.
    expect(row.note).toBe("კი, [phone:***56]");
    const mail = (deps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(mail.to).toBe(CALLBACK_RECIPIENT);
    expect(mail.subject).toBe("📞 დარეკვა: +995 577 12 34 56");
    expect(deps.update).toHaveBeenCalledWith("row-1", { email_sent_at: "2026-10-15T10:05:00.000Z" });
  });

  it("same phone within 24h → skipped before the rate limit is charged", async () => {
    const deps = fakeDeps({ recentRequestExists: vi.fn(async () => true) });
    expect(await handleCallbackRequest(deps, input([user("577123456")]))).toBe("duplicate");
    expect(deps.rateLimit).not.toHaveBeenCalled();
    expect(deps.insert).not.toHaveBeenCalled();
  });

  it("over the limit → no insert, no e-mail", async () => {
    const deps = fakeDeps({ rateLimit: vi.fn(async () => false) });
    expect(await handleCallbackRequest(deps, input([user("577123456")]))).toBe("rate_limited");
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("rate-limit check failed (null) → fails open", async () => {
    const deps = fakeDeps({ rateLimit: vi.fn(async () => null) });
    expect(await handleCallbackRequest(deps, input([user("577123456")]))).toBe("sent");
  });

  it("insert failed → no e-mail", async () => {
    const deps = fakeDeps({ insert: vi.fn(async () => null) });
    expect(await handleCallbackRequest(deps, input([user("577123456")]))).toBe("insert_failed");
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it("e-mail failed → email_error recorded", async () => {
    const deps = fakeDeps({ sendEmail: vi.fn(async () => ({ ok: false, error: "Resend HTTP 500" })) });
    expect(await handleCallbackRequest(deps, input([user("577123456")]))).toBe("email_failed");
    expect(deps.update).toHaveBeenCalledWith("row-1", { email_error: "Resend HTTP 500" });
  });

  it("never throws", async () => {
    const deps = fakeDeps({ recentRequestExists: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(handleCallbackRequest(deps, input([user("577123456")]))).resolves.toBe("error");
  });
});

describe("FAQ_KB (gemini-proxy/index.ts) carries the new rules", () => {
  const src = readFileSync(path.resolve(__dirname, "../../supabase/functions/gemini-proxy/index.ts"), "utf8");

  it("has the §0 STOCK rule, §9d and the escaped empty block", () => {
    expect(src).toContain("⚠️ CRITICAL — STOCK / მარაგი.");
    expect(src).toContain("## 9d. CALLBACK REQUEST / ზარის მოთხოვნა");
    expect(src).toContain("\\`\\`\\`maika-callback\n{}\n\\`\\`\\`");
    expect(src).toContain("მარაგს ჩატიდან არასოდეს ადასტურებ — იხ. §0 STOCK.");
  });

  it("keeps §9b's five ordering channels unchanged", () => {
    expect(src).toContain("KA: შეკვეთა შესაძლებელია ხუთი გზით:");
    expect(src).toContain("ინფორმაციისთვის დაგვირეკეთ (შეკვეთა ტელეფონით არ მიიღება): +995 32 2 05 06 20 · 599 05 08 07");
  });
});
