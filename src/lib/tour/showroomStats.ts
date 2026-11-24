// The showroom's own funnel (2026-11-24, David: "separate analytics — how many
// came in, how many stayed, who ordered from the showroom").
//
// Each step a visitor reaches is written once per tab session to
// public.showroom_events (migration 20261124120000): a random session id, the
// step and where the visit came from — no personal data. The same steps go to
// GA4 as showroom_<step>, and two of them to the Meta pixel as standard events
// (ViewContent on coming in, CustomizeProduct on printing) so an ad can later
// be aimed at people who design, not at people who click.
//
// Nothing here may ever break or slow the walk: every call is fire-and-forget
// and swallows its errors. Orders are not counted here — they carry the
// showroom mark in order_attribution (attribution.ts).
import { supabase } from "@/integrations/supabase/client";
import { readAttribution, type AttrBlob } from "@/lib/attribution";
import { trackEvent } from "@/lib/gtag";
import { trackMeta } from "@/lib/metaPixel";

export type ShowroomStep = "open" | "enter" | "stay_30" | "stay_60" | "stay_180" | "rack" | "photo" | "text" | "print" | "fitting" | "order";

const SID_KEY = "maika.showroom.sid";
const SENT_KEY = "maika.showroom.stats";
/** A last touch older than this belongs to an earlier visit, not to this one. */
export const VISIT_WINDOW_MS = 30 * 60 * 1000;
/** Seconds in the shop (tab visible) that count as "stayed". */
export const STAY_MARKS = [30, 60, 180] as const;

export interface VisitSource {
  source: string;
  medium?: string;
  campaign?: string;
}

const clip = (v: string | undefined, n: number) => (v ? v.trim().toLowerCase().slice(0, n) || undefined : undefined);

/** Where THIS visit came from: the last touch if it is fresh, else the in-app browser, else direct. */
export function visitSource(blob: AttrBlob | null, now: number): VisitSource {
  const lt = blob?.lt;
  if (lt && typeof lt.ts === "number" && now - lt.ts >= 0 && now - lt.ts <= VISIT_WINDOW_MS) {
    const medium = clip(lt.medium, 80);
    const campaign = clip(lt.campaign, 120);
    const src = clip(lt.source, 80);
    if (src) return { source: src, medium, campaign };
    if (lt.fbclid) return { source: "meta", medium, campaign };
    if (lt.gclid) return { source: "google", medium, campaign };
    const host = clip(lt.referrer?.split("/")[0], 80);
    if (host) return { source: host, medium: medium ?? "referral", campaign };
  }
  if (blob?.in_app) return { source: blob.in_app, medium: "in-app" };
  return { source: "direct" };
}

/** Only the real site is counted — previews and local runs would only add noise. */
export function countedHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "maika.ge" || h.endsWith(".maika.ge") || h === "xn--lodaxeh.xn--node" || h.endsWith(".xn--lodaxeh.xn--node");
}

const sent = new Set<string>();
let loaded = false;
function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    for (const k of JSON.parse(sessionStorage.getItem(SENT_KEY) || "[]") as string[]) sent.add(k);
  } catch {
    /* no storage: the memory set alone */
  }
}
function sessionId(): string {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return "nostore";
  }
}

/** Record that this visitor reached a step. Once per tab session per step (+detail). */
export function showroomStat(step: ShowroomStep, detail?: string): void {
  try {
    if (typeof window === "undefined" || !countedHost(window.location.hostname)) return;
    load();
    const key = detail ? `${step}:${detail}` : step;
    if (sent.has(key)) return;
    sent.add(key);
    try {
      sessionStorage.setItem(SENT_KEY, JSON.stringify([...sent]));
    } catch {
      /* fine */
    }
    const src = visitSource(readAttribution(), Date.now());
    // showroom_events is not in the generated types (manual migration)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void (supabase as any)
      .from("showroom_events")
      .insert({ session_id: sessionId(), event: step, detail: detail?.slice(0, 64) ?? null, source: src.source, medium: src.medium ?? null, campaign: src.campaign ?? null })
      .then(
        () => undefined,
        () => undefined,
      );
    trackEvent(`showroom_${step}`, detail ? { detail } : {});
    if (step === "enter") trackMeta("ViewContent", { content_name: "showroom" });
    if (step === "print") trackMeta("CustomizeProduct", { content_name: "showroom" });
  } catch {
    /* analytics must never break the walk */
  }
}

/** Counts seconds with the tab visible and reports the STAY_MARKS. Returns the stop function. */
export function startStayClock(): () => void {
  let secs = 0;
  const id = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    secs += 1;
    for (const m of STAY_MARKS) if (secs === m) showroomStat(`stay_${m}` as ShowroomStep);
    if (secs > STAY_MARKS[STAY_MARKS.length - 1]) window.clearInterval(id);
  }, 1000);
  return () => window.clearInterval(id);
}
