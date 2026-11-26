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
