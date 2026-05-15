import { COLORS } from "@/lib/catalog";
import { Check } from "lucide-react";

interface Props {
  value: string | null | undefined;
  onChange: (colorName: string) => void;
  className?: string;
}

/**
 * Visual color picker for the catalog mockup background color.
 * Uses the same canonical COLORS list as the customer-facing product picker
 * so admin choices map 1:1 to render-time tinting.
 */
export default function MockupColorPicker({ value, onChange, className }: Props) {
  const current = (value || "White").toLowerCase();
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {COLORS.map((c) => {
        const active = c.name.toLowerCase() === current;
        return (
          <button
            key={c.name}
            type="button"
            onClick={() => onChange(c.name)}
            title={c.name}
            aria-label={c.name}
            className={`relative h-7 w-7 rounded-full border transition-all ${
              active ? "ring-2 ring-primary ring-offset-1 ring-offset-background border-primary" : "border-border hover:scale-110"
            }`}
            style={{ backgroundColor: c.hex }}
          >
            {active && (
              <Check
                className="absolute inset-0 m-auto h-3.5 w-3.5"
                style={{ color: isLight(c.hex) ? "#000" : "#fff" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function isLight(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
}
