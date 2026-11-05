// Admin-only block in the cart / order dialog: save as a showroom order
// (no card payment) and choose whether it is already paid. Renders nothing
// for customers. See src/lib/showroomOrder.ts.

import type { ShowroomMode } from "@/lib/showroomOrder";

interface Props {
  value: ShowroomMode;
  onChange: (v: ShowroomMode) => void;
}

const OPTIONS: { id: ShowroomMode; label: string }[] = [
  { id: "paid", label: "გადახდილია" },
  { id: "unpaid", label: "გადაუხდელია" },
  { id: "card", label: "ბარათით (Flitt)" },
];

export default function ShowroomOrderChoice({ value, onChange }: Props) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
      <p className="text-sm font-semibold">მაღაზიის შეკვეთა</p>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`h-10 rounded-md border text-xs font-medium transition ${
              value === o.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        ჩანს მხოლოდ ადმინისთვის. „გადახდილია" / „გადაუხდელია" — შეკვეთა ინახება ბარათით გადახდის გარეშე და ადმინკაში ჩნდება.
      </p>
    </div>
  );
}
