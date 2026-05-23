import { Minus, Plus } from "lucide-react";

interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export default function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  disabled = false,
}: QuantityStepperProps) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        className="h-9 w-9 rounded-md border border-border flex items-center justify-center disabled:opacity-40 hover:bg-accent transition-colors"
        aria-label="შემცირება"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="text-sm font-semibold w-8 text-center" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={inc}
        disabled={disabled || value >= max}
        className="h-9 w-9 rounded-md border border-border flex items-center justify-center disabled:opacity-40 hover:bg-accent transition-colors"
        aria-label="გაზრდა"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
