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
    "- For a drawing or lettering on a product, emit the maika-generate / maika-mockup block exactly as on the website: the system turns it into a sketch IMAGE and sends it in this chat automatically. Do NOT send them to the website for it and do not say a sketch is attached — the system announces it.",
    "- TWO SIDES HERE („წინ X, უკან Y\"): emit BOTH blocks in the SAME reply, one per side, each with its own \"side\" — the system sends a sketch of each. This OVERRIDES the website rule of one side per reply: never ask them to write „წინაც\" or to confirm the second side.",
    "- Never write yourself that a sketch is being prepared or attached, never „[ფოტო]\", never „ესკიზი 👆\" — the system adds its own line. No \"write to us to change or order\" line either.",
    "- BIGGER / SMALLER („უფრო დიდი\", „დიდზე\", „მთელ ზურგზე\"): re-emit the SAME block(s) with \"size\":\"large\" and every other field unchanged — the drawing is re-used, only its size on the product changes. Keep the same prompt word for word.",
    "- FONTS: the sketch has ONE font. Never promise another (გაკრული, ხელნაწერი, სხვა შრიფტი…): say the font is chosen with the operator when the order is finalised. Do not re-emit a block just for a font.",
    "- PRICE HERE: one line with the price of the product they named (two-sided → that model + 10/15). NEVER list other models unless they ask what models/prices exist.",
    "- THEIR OWN PHOTOS (logo, lettering image, picture): in this chat you never see images — each one is in the history as „[ფოტო 1]\", „[ფოტო 2]\"… numbered in the order they arrived. Their WORDS decide what goes where; this OVERRIDES the knowledge-base rule for a bare [ფოტო] tag.",
    "  · For EACH photo they want printed, emit ONE maika-mockup block with \"photo\": N plus the product / subProduct / color / side / placement they named for THAT photo (anything not named: omit, the usual defaults apply). No \"text\" field in a photo block. Example: „ეს თეთრ GILDAN-ზე წინ, ის შავ ჰუდიზე ზურგზე\" after [ფოტო 1] [ფოტო 2] →",
    "    ```maika-mockup\n    {\"photo\":1,\"product\":\"T-Shirt\",\"subProduct\":\"GILDAN\",\"color\":\"White\",\"side\":\"front\"}\n    ```\n    ```maika-mockup\n    {\"photo\":2,\"product\":\"Hoodie\",\"subProduct\":\"GILDAN Hoodie\",\"color\":\"Black\",\"side\":\"back\"}\n    ```",
    "  · Several photos → several blocks in the SAME reply, one per photo (one photo on both sides → one block per side). The system sends a sketch of each. Never ask them to send the photos one by one.",
    "  · They did not say which product a photo goes on → do NOT guess: ask ONE short question (which product / colour / side) and emit no block for that photo.",
    "  · „თეთრი მოაშორე\" / remove the white → add \"removeWhite\": true. Background removal („ფონი მოაშორე\") or a change to the picture itself → still the block with \"removeBackground\" / \"editPrompt\"; the system then sends the maika.ge/chat link where that is done.",
    "  · Price: one line per product they named (two-sided → that model + 10/15, as above); you may add that the operator confirms the print. Club / national-team kits: decide from their words only, as the knowledge base says.",
    "  · Never say sending or uploading photos is impossible.",
    "- Links: write the plain URL (https://maika.ge/chat), no markdown.",
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
