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

/**
 * DM ORDERS (add-only, 2026-11-01). Only when the webhook sends
 * params.dm_orders = true (its draft table is readable): these lines replace
 * the "do not take orders" line. Without the flag the block is byte-identical
 * to before. The webhook (meta-webhook/orderFlow.ts) reads the maika-order
 * block, prices it in code and writes every number the customer sees.
 */
export function socialOrderRules(back: string): string[] {
  return [
    `- Never confirm a payment or say an order is paid: an operator checks bank transfers ${back}.`,
    "- ORDERS HERE: you can take an order for what was sketched in this chat. Our side of the history lists the sketches as „[ესკიზი N: …]\" — N is the item number; the front and back of one garment are ONE item. Never copy these tags (or „[შეკვეთა #…]\") into your reply.",
    "  · When they want to order, ask in ONE short message for whatever is still missing: which sketch(es), the size of each (only sizes that brand has), how many, delivery (pickup free / courier Tbilisi 8 ₾ / courier regions 12 ₾), first and last name, phone, and the address for a courier. A phone shown as [phone:***NN] in the history means we HAVE it — never ask for it again.",
    "  · As soon as everything is known, reply with ONLY this block (the system writes the summary with the exact prices — never write prices, totals or a summary yourself):",
    "    ```maika-order\n    {\"confirm\":false,\"items\":[{\"sketch\":1,\"size\":\"M\",\"qty\":1}],\"delivery\":\"courier_tbilisi\",\"name\":\"სახელი გვარი\",\"address\":\"ქალაქი, ქუჩა, ნომერი\"}\n    ```",
    "    delivery is pickup, courier_tbilisi or courier_outside; address only for a courier; one entry per sketch + size (two sizes of one sketch → two entries). Only sketches they want — not every sketch shown.",
    "  · When they confirm THAT summary („ვადასტურებ\", „კი\", „დიახ\"), reply with ONLY ```maika-order\n    {\"confirm\":true}\n    ``` — the system creates the order from the summary it showed and sends the bank transfer details. Never say yourself that the order is placed. Any change instead → the full block with the change and \"confirm\":false.",
    "  · Never emit maika-order together with maika-mockup / maika-generate. „[შეკვეთა #… ელოდება გადარიცხვას]\" in the history = that order exists: ask them to send the transfer receipt here; changes to it go through the operator. A photo sent after that without other words is most likely the receipt: thank them and say the operator will check it — NO sketch block for it.",
  ];
}

export function socialPromptBlock(channel: SocialChannel, schedule: SocialSchedule, opts?: { orders?: boolean }): string {
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
    ...(opts?.orders
      ? socialOrderRules(back)
      : [`- Do not take orders or confirm payments: explain how to order and say an operator will finalize ${back}.`]),
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
export function withSocialBlock(
  systemContent: string,
  channel: SocialChannel | null,
  schedule: SocialSchedule = "sunday",
  opts?: { orders?: boolean },
): string {
  if (!channel) return systemContent;
  const block = socialPromptBlock(channel, schedule, opts);
  const at = systemContent.lastIndexOf("\n\nCALLER: ");
  if (at === -1) return `${systemContent}\n\n${block}`;
  return `${systemContent.slice(0, at)}\n\n${block}${systemContent.slice(at)}`;
}

/** The webhook's DM order flag; only meaningful for a trusted social channel. */
export function socialOrdersOn(channel: SocialChannel | null, dmOrders: unknown): boolean {
  return !!channel && dmOrders === true;
}

/**
 * chat_logs copy of a reply (add-only, 2026-11-01): the "name" / "address"
 * values inside a ```maika-order block are replaced with "***". They live in
 * the admin-only order draft; the log keeps the rest of the block. Text
 * without such a block → the same string.
 */
export function redactOrderBlockForLog(text: string): string {
  if (!text || !/```maika-order(?![\w-])/.test(text)) return text;
  return text.replace(/```maika-order(?![\w-])[\s\S]*?(```|$)/g, (fence) =>
    fence.replace(/("(?:name|address)"\s*:\s*)"(?:[^"\\]|\\.)*"/g, '$1"***"'));
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
