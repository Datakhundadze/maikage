import type { PriceBreakdown } from "@/lib/pricing";
import { useAppState } from "@/hooks/useAppState";

interface PriceDisplayProps {
  breakdown: PriceBreakdown;
}

export default function PriceDisplay({ breakdown }: PriceDisplayProps) {
  const { lang } = useAppState();
  const { basePrice, backExtra, aiSurcharge, total } = breakdown;
  const gel = lang === "en" ? "GEL" : "₾";

  const lines: { label: string; amount: number }[] = [];

  lines.push({
    label: lang === "en" ? "Front print" : "წინა ბეჭდვა",
    amount: basePrice,
  });

  if (backExtra > 0) {
    lines.push({
      label: `+ ${lang === "en" ? "Back side" : "უკანა მხარე"}`,
      amount: backExtra,
    });
  }

  if (aiSurcharge > 0) {
    lines.push({
      label: `+ ${lang === "en" ? "AI design" : "AI დიზაინი"}`,
      amount: aiSurcharge,
    });
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-card-foreground">
          {lang === "en" ? "Price" : "ფასი"}
        </span>
        <span className="text-lg font-bold text-primary">
          {total} {gel}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {lang === "en" ? "Price includes A4 print size" : "თანხაში გათვალისწინებულია A4 ზომა"}
      </p>
    </div>
  );
}
