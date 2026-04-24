import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export type PaymentMethod = "bog" | "tbc";

const METHODS: { value: PaymentMethod; label: string; desc: string }[] = [
  { value: "bog", label: "საქართველოს ბანკი", desc: "ბარათით გადახდა" },
  { value: "tbc", label: "TBC", desc: "ბარათი / Apple Pay / Google Pay" },
];

interface Props {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
}

export default function PaymentMethodSelector({ value, onChange }: Props) {
  return (
    <div className="space-y-2">
      <Label>გადახდის მეთოდი *</Label>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as PaymentMethod)} className="space-y-2">
        {METHODS.map((m) => (
          <div
            key={m.value}
            className="flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
          >
            <RadioGroupItem value={m.value} id={`pay-${m.value}`} />
            <Label htmlFor={`pay-${m.value}`} className="cursor-pointer flex-1">
              <span className="text-sm font-medium">{m.label}</span>
              <span className="block text-xs text-muted-foreground">{m.desc}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
