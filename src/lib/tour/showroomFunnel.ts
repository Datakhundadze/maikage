// Shapes the rows of admin_showroom_funnel (sessions per day × source × step)
// into the tables the admin shows. Pure — tested in showroomStats.test.ts.
import type { ShowroomStep } from "@/lib/tour/showroomStats";

export interface FunnelRow {
  day: string;
  source: string;
  medium: string;
  event: string;
  sessions: number;
}

export const FUNNEL_STEPS: { step: ShowroomStep; label: string }[] = [
  { step: "open", label: "გვერდი გახსნა" },
  { step: "enter", label: "კარში შევიდა" },
  { step: "stay_30", label: "30 წმ+" },
  { step: "stay_60", label: "1 წთ+" },
  { step: "stay_180", label: "3 წთ+" },
  { step: "rack", label: "თარო გახსნა" },
  { step: "photo", label: "ფოტო ატვირთა" },
  { step: "text", label: "ტექსტი დაწერა" },
  { step: "print", label: "დაბეჭდა" },
  { step: "fitting", label: "გასახდელი" },
  { step: "order", label: "შეკვეთაზე გადავიდა" },
];

export type StepCounts = Partial<Record<ShowroomStep, number>>;

export const sourceLabel = (source: string, medium: string) => (medium ? `${source} / ${medium}` : source);

/** Sessions per step, grouped by the key the caller picks (a day, a source…), plus the total. */
export function funnelBy(rows: FunnelRow[], keyOf: (r: FunnelRow) => string): { groups: { key: string; counts: StepCounts }[]; total: StepCounts } {
  const map = new Map<string, StepCounts>();
  const total: StepCounts = {};
  for (const r of rows) {
    const n = Number(r.sessions) || 0;
    const k = keyOf(r);
    const c = map.get(k) ?? {};
    const step = r.event as ShowroomStep;
    c[step] = (c[step] ?? 0) + n;
    map.set(k, c);
    total[step] = (total[step] ?? 0) + n;
  }
  return { groups: [...map.entries()].map(([key, counts]) => ({ key, counts })), total };
}

/** "37%" of those who opened the page; "" when nobody did. */
export function shareOfOpen(counts: StepCounts, step: ShowroomStep): string {
  const open = counts.open ?? 0;
  const n = counts[step] ?? 0;
  if (!open || step === "open") return "";
  return `${Math.round((n / open) * 100)}%`;
}
