// faq-chat as the Messenger / Instagram auto-reply bot (add-only, 2026-10-31).
//
// The meta-webhook edge function calls faq-chat SERVER TO SERVER with
// params.channel = 'messenger' | 'instagram' and
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. The channel is TRUSTED
// only when that bearer equals this function's own SUPABASE_SERVICE_ROLE_KEY
// (constant-time compare) — no new secret, and a browser can never assert it.
// A website call (no channel, or no service-role bearer) resolves to null and
// faq-chat behaves exactly as before: same gate, same prompt, same log.
//
// For a trusted channel: the anonymous faq-chat rate limit is skipped (the
// webhook caps bot messages per conversation itself), chat_logs gets
// session_id = the conversation_key the webhook sends, and the block below is
// added to the system turn, right before the CALLER line (which stays last).

export type SocialChannel = "messenger" | "instagram";
export type SocialSchedule = "sunday" | "off_hours";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function resolveTrustedSocialChannel(
  action: unknown,
  channel: unknown,
  authorization: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): SocialChannel | null {
  if (action !== "faq-chat") return null;
  if (channel !== "messenger" && channel !== "instagram") return null;
  if (!serviceRoleKey || typeof authorization !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return null;
  return timingSafeEqual(m[1].trim(), serviceRoleKey) ? channel : null;
}

export function socialSchedule(v: unknown): SocialSchedule {
  return v === "off_hours" ? "off_hours" : "sunday";
}

export function socialPromptBlock(channel: SocialChannel, schedule: SocialSchedule): string {
  const where = channel === "instagram" ? "Instagram" : "Facebook Messenger";
  const off = schedule === "sunday" ? "(Sunday)" : "(outside working hours)";
  const back = schedule === "sunday"
    ? "on Monday from 11:00"
    : "during working hours (Mon–Fri 11:00–19:00, Sat 11:00–18:00)";
  return [
    "═══════════════════════════════════════════════════════════════",
    "SOCIAL DM MODE",
    `You are answering in ${where} on behalf of maika.ge while operators are off ${off}.`,
    "- Keep replies short (max ~5 lines), Georgian unless the customer writes another language.",
    `- Do not take orders or confirm payments: explain how to order and say an operator will finalize ${back}.`,
    "- For a drawing or mockup, invite them to https://maika.ge/chat where they can see the design.",
    "- Tell them they can type „ოპერატორი\" to reach a human.",
  ].join("\n");
}

/**
 * Insert the block before the final "\n\nCALLER: " line. With channel null the
 * content is returned unchanged (the website path).
 */
export function withSocialBlock(systemContent: string, channel: SocialChannel | null, schedule: SocialSchedule = "sunday"): string {
  if (!channel) return systemContent;
  const block = socialPromptBlock(channel, schedule);
  const at = systemContent.lastIndexOf("\n\nCALLER: ");
  if (at === -1) return `${systemContent}\n\n${block}`;
  return `${systemContent.slice(0, at)}\n\n${block}${systemContent.slice(at)}`;
}

// ── DM sketch (add-only, 2026-10-31) ───────────────────────────────────────
//
// meta-webhook renders a sketch for a DM by calling generate-design-gpt
// SERVER TO SERVER, exactly like faq-chat above: params.channel plus the
// service-role bearer. That caller has no user and one shared egress IP, so
// the anonymous BILLABLE gate (gen:ip:<ip>, 4 units a day) would refuse the
// bot after a few sketches for EVERYONE. For this trusted call only, the gate
// is skipped; the webhook caps sketches per conversation itself (3 generated
// designs per 24 h). Every website call (no channel, an anon key, a user JWT)
// resolves to null and goes through the gate exactly as before.

export const SOCIAL_SKETCH_ACTION = "generate-design-gpt";

export function resolveTrustedSocialSketch(
  action: unknown,
  channel: unknown,
  authorization: string | null | undefined,
  serviceRoleKey: string | null | undefined,
): SocialChannel | null {
  if (action !== SOCIAL_SKETCH_ACTION) return null;
  // Same bearer / channel check as faq-chat, asked as faq-chat.
  return resolveTrustedSocialChannel("faq-chat", channel, authorization, serviceRoleKey);
}

/** Does the BILLABLE rate-limit / block gate apply to this call? */
export function billableGateApplies(isBillableAction: boolean, trustedSketchChannel: SocialChannel | null): boolean {
  return isBillableAction && !trustedSketchChannel;
}
