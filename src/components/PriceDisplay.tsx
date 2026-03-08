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
    const backLabel =
      breakdown.backType === "photo"
        ? lang === "en" ? "Back photo" : "უკანა ფოტო"
        : lang === "en" ? "Back text" : "უკანა ტექსტი";
    lines.push({ label: `+ ${backLabel}`, amount: backExtra });
  }

  if (aiSurcharge > 0) {
    lines.push({
      label: `+ ${lang === "en" ? "AI design" : "AI დიზაინი"}`,
      amount: aiSurcharge,
    });
  }

  const showBreakdown = lines.length > 1;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-card-foreground">
          {lang === "en" ? "Price" : "ფასი"}
        </span>
        <span className="text-lg font-bold text-primary">
          {total} {gel}
        </span>
      </div>
      {showBreakdown && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {lines.map((line, i) => (
            <div key={i} className="flex justify-between">
              <span>{line.label}</span>
              <span>{line.amount} {gel}</span>
            </div>
          ))}
          <div className="border-t border-border mt-1 pt-1 flex justify-between font-medium text-card-foreground">
            <span>{lang === "en" ? "Total" : "სულ"}</span>
            <span>{total} {gel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
