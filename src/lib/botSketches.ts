// BOT SKETCHES PAGE (owner 2026-11-26) — pure helpers for the admin
// "ბოტის ესკიზები" tab (src/components/admin/AdminBotSketches.tsx).

export interface BotSketchRow {
  id: string;
  conversation_key: string;
  channel: string;
  kind: string;
  sketch_url: string;
  print_path: string | null;
  source_path: string | null;
  created_at: string;
  downloaded_at: string | null;
}

export interface SocialContact {
  conversation_key: string;
  name: string | null;
  username: string | null;
}

export const CHANNEL_LABEL: Record<string, string> = {
  messenger: "Messenger",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

/** Customer id part of "channel:page:customer". */
export function customerIdOf(conversationKey: string): string {
  const parts = conversationKey.split(":");
  return parts[parts.length - 1] ?? conversationKey;
}

/**
 * What the team sees as "who": the Meta profile name (and @username on
 * Instagram), the phone number on WhatsApp, otherwise "კლიენტი …123456".
 */
export function sketchCustomerLabel(row: Pick<BotSketchRow, "conversation_key" | "channel">, contact?: SocialContact | null): string {
  const name = contact?.name?.trim();
  const user = contact?.username?.trim();
  if (name && user) return `${name} (@${user})`;
  if (name) return name;
  if (user) return `@${user}`;
  const id = customerIdOf(row.conversation_key);
  if (row.channel === "whatsapp") return `+${id}`;
  return `კლიენტი …${id.slice(-6)}`;
}

/** Safe download file name: "<who>-<dd.MM>-<HHmm>.png". */
export function sketchFileName(label: string, createdAtIso: string, ext = "png"): string {
  const d = new Date(createdAtIso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = Number.isNaN(d.getTime())
    ? "sketch"
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const who = label.replace(/[\\/:*?"<>|@()…]+/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "maika";
  return `${who}-${stamp}.${ext}`;
}

/** Rows not downloaded yet — the tab badge. */
export const isNewSketch = (row: Pick<BotSketchRow, "downloaded_at">) => !row.downloaded_at;
