// CONTACT NAMES (add-only, owner 2026-11-26): the admin "ბოტის ესკიზები" page
// shows who each sketch went to, so the team can find the chat in Business
// Suite. Names come from the Meta profile APIs with the Page token:
//   Messenger  GET /{PSID}?fields=first_name,last_name
//   Instagram  GET /{IGSID}?fields=name,username
// WhatsApp keys are phone numbers — no lookup. Pure helpers here; the fetch
// and the upsert live in index.ts. Nothing here is logged.

export interface ContactLookup {
  channel: "messenger" | "instagram";
  customerId: string;
  fields: string;
}

export interface ContactName {
  name: string | null;
  username: string | null;
}

/** conversation key "channel:page:customer" → what to ask Graph, or null. */
export function contactLookup(conversationKey: string): ContactLookup | null {
  const parts = conversationKey.split(":");
  if (parts.length !== 3) return null;
  const [channel, , customerId] = parts;
  if (!/^\d{5,25}$/.test(customerId)) return null;
  if (channel === "messenger") return { channel, customerId, fields: "first_name,last_name" };
  if (channel === "instagram") return { channel, customerId, fields: "name,username" };
  return null;
}

const clean = (v: unknown, max = 80): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** Graph profile JSON → display name / username, or null when it carries neither. */
export function contactFromGraph(channel: ContactLookup["channel"], data: unknown): ContactName | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  let name: string | null;
  let username: string | null = null;
  if (channel === "messenger") {
    name = clean([clean(d.first_name), clean(d.last_name)].filter(Boolean).join(" "));
  } else {
    name = clean(d.name);
    username = clean(d.username, 40);
  }
  return name || username ? { name, username } : null;
}

// ── fallback name + bot label (add-only, owner 2026-11-27) ─────────────────
// The Messenger profile fields came back empty for every customer, so the
// name falls back to the conversation participants (pages_messaging):
//   GET /{PAGE}/conversations?platform=messenger|instagram&user_id={id}&fields=participants
// and every conversation the bot answers gets the Page inbox label
// BOT_LABEL_NAME, visible and filterable in Meta Business Suite:
//   GET/POST /{PAGE}/custom_labels, POST /{label}/label {user}

export const BOT_LABEL_NAME = "ბოტმა უპასუხა";

/** Conversations-API path (no host, no token) for one customer. */
export function conversationLookupPath(pageId: string, look: ContactLookup): string {
  return `${pageId}/conversations?platform=${look.channel}&user_id=${look.customerId}&fields=participants`;
}

/** The customer's name / username from a conversations-API answer. */
export function nameFromConversations(data: unknown, customerId: string): ContactName | null {
  const convs = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(convs)) return null;
  for (const c of convs) {
    const parts = (c as { participants?: { data?: unknown } } | null)?.participants?.data;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const r = (p ?? {}) as Record<string, unknown>;
      if (String(r.id ?? "") !== customerId) continue;
      const name = clean(r.name);
      const username = clean(r.username, 40);
      if (name || username) return { name, username };
    }
  }
  return null;
}

/** id of the label called `name` in a GET custom_labels answer, else null. */
export function labelIdFrom(data: unknown, name: string): string | null {
  const rows = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return null;
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (o.page_label_name === name && typeof o.id === "string" && o.id) return o.id;
  }
  return null;
}
