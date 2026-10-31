// When the social auto-reply bot may answer. Pure: no Deno, no I/O, so vitest
// drives it directly. Times are Asia/Tbilisi wall-clock (UTC+4, no DST since
// 2005), resolved with Intl so a future tz-database change is picked up too.
//
//   'sunday'     Sunday 00:00–23:59, Tbilisi.
//   'off_hours'  Sunday all day + Mon–Fri outside 11:00–19:00
//                + Saturday outside 11:00–18:00 (the shop's working hours).
//
// Anything else (an unknown value in the settings row) → never active: the
// safe failure for a switch that sends messages to customers.

export type BotSchedule = "sunday" | "off_hours";

export const BOT_TIMEZONE = "Asia/Tbilisi";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday (0 = Sunday) and minutes since midnight, in Tbilisi. */
export function tbilisiClock(now: Date): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOT_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WEEKDAYS.indexOf(get("weekday"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { weekday, minutes: hour * 60 + minute };
}

export function isBotSchedule(v: unknown): v is BotSchedule {
  return v === "sunday" || v === "off_hours";
}

export function isScheduleActive(schedule: unknown, now: Date): boolean {
  if (!isBotSchedule(schedule)) return false;
  const { weekday, minutes } = tbilisiClock(now);
  if (weekday < 0 || !Number.isFinite(minutes)) return false;
  if (weekday === 0) return true;
  if (schedule === "sunday") return false;
  const open = 11 * 60;
  const close = weekday === 6 ? 18 * 60 : 19 * 60;
  return minutes < open || minutes >= close;
}
