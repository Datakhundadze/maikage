import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export type PaymentMethod = "bog" | "tbc";

// width/height match each PNG's intrinsic aspect (scaled-down) so the
// browser reserves a stable box during image load → zero CLS as the
// payment radio panel renders.
type CardLogo = { src: string; alt: string; width: number; height: number };

const CARD_VISA: CardLogo = { src: "/payment-logos/visa.png", alt: "Visa", width: 192, height: 62 };
const CARD_MC: CardLogo = { src: "/payment-logos/mastercard.png", alt: "Mastercard", width: 192, height: 149 };
const CARD_APPLE: CardLogo = { src: "/payment-logos/apple-pay.png", alt: "Apple Pay", width: 32, height: 32 };
const CARD_GPAY: CardLogo = { src: "/payment-logos/google-pay.png", alt: "Google Pay", width: 84, height: 86 };

const METHODS: {
  value: PaymentMethod;
  label: string;
  desc: string;
  bankLogo: string;
  bankAlt: string;
  bankLogoWidth: number;
  bankLogoHeight: number;
  cards: CardLogo[];
}[] = [
  {
    value: "bog",
    label: "საქართველოს ბანკი",
    desc: "ბარათით გადახდა",
    bankLogo: "/payment-logos/bog.png",
    bankAlt: "Bank of Georgia",
    bankLogoWidth: 77,
    bankLogoHeight: 13,
    cards: [CARD_VISA, CARD_MC],
  },
  {
    value: "tbc",
    label: "TBC",
    desc: "ბარათით გადახდა",
    bankLogo: "/payment-logos/tbc.png",
    bankAlt: "TBC Bank",
    bankLogoWidth: 128,
    bankLogoHeight: 45,
    cards: [CARD_VISA, CARD_MC, CARD_APPLE, CARD_GPAY],
  },
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
            className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
              value === m.value
                ? "border-primary bg-[hsl(0_0%_92%)]"
                : "border-border bg-[hsl(0_0%_96%)] hover:bg-[hsl(0_0%_93%)]"
            }`}
          >
            <RadioGroupItem value={m.value} id={`pay-${m.value}`} />
            <Label
              htmlFor={`pay-${m.value}`}
              className="cursor-pointer flex-1 min-w-0 flex items-center gap-2 flex-nowrap"
            >
              <img
                src={m.bankLogo}
                alt={m.bankAlt}
                width={m.bankLogoWidth}
                height={m.bankLogoHeight}
                className="h-7 md:h-8 w-auto object-contain shrink-0"
                loading="lazy"
              />
              <span className="sr-only">
                {m.label} — {m.desc}
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5 ml-auto flex-nowrap shrink-0">
                {m.cards.map((c) => (
                  <img
                    key={c.alt}
                    src={c.src}
                    alt={c.alt}
                    title={c.alt}
                    width={c.width}
                    height={c.height}
                    className="h-4 sm:h-5 w-auto object-contain shrink-0"
                    loading="lazy"
                  />
                ))}
              </div>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
