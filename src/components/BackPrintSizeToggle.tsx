import type { BackPrintSize } from "@/lib/pricing";
import { useAppState } from "@/hooks/useAppState";

interface BackPrintSizeToggleProps {
  value: BackPrintSize;
  onChange: (size: BackPrintSize) => void;
  /** ₾ over the front-only price, from pricing.getBackPrintExtras (never hardcoded). */
  extras: { small: number; big: number };
}

// Two-option picker for the back print size, shown under the price only when
// both sides have a design and the product prices the sizes differently.
export default function BackPrintSizeToggle({ value, onChange, extras }: BackPrintSizeToggleProps) {
  const { lang } = useAppState();
  const en = lang === "en";
  const options: { size: BackPrintSize; label: string; extra: number }[] = [
    { size: "small", label: en ? "Small" : "პატარა", extra: extras.small },
    { size: "big", label: en ? "Large" : "დიდი", extra: extras.big },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p id="back-print-size-label" className="text-sm font-semibold text-card-foreground mb-2">
        {en ? "Back print" : "უკანა პრინტი"}
      </p>
      <div
        role="radiogroup"
        aria-labelledby="back-print-size-label"
        className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        {options.map((o) => {
          const active = value === o.size;
          return (
            <button
              key={o.size}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.size)}
              className={`rounded-md px-2 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label} <span className="whitespace-nowrap">(+{o.extra}₾)</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
        {en
          ? "Small — lettering or a small logo; Large — a big image/print"
          : "პატარა — წარწერა ან პატარა ლოგო; დიდი — დიდი სურათი/პრინტი"}
      </p>
    </div>
  );
}
