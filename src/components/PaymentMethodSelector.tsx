import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

export type PaymentMethod = "bog" | "tbc";

type CardLogo = { src: string; alt: string };

const CARD_VISA: CardLogo = { src: "/payment-logos/visa.png", alt: "Visa" };
const CARD_MC: CardLogo = { src: "/payment-logos/mastercard.png", alt: "Mastercard" };
const CARD_APPLE: CardLogo = { src: "/payment-logos/apple-pay.png", alt: "Apple Pay" };
const CARD_GPAY: CardLogo = { src: "/payment-logos/google-pay.png", alt: "Google Pay" };

const METHODS: {
  value: PaymentMethod;
  label: string;
  desc: string;
  bankLogo: string;
  bankAlt: string;
  cards: CardLogo[];
}[] = [
  {
    value: "bog",
    label: "საქართველოს ბანკი",
    desc: "ბარათით გადახდა",
    bankLogo: "/payment-logos/bog.png",
    bankAlt: "Bank of Georgia",
    cards: [CARD_VISA, CARD_MC],
  },
  {
    value: "tbc",
    label: "TBC",
    desc: "ბარათით გადახდა",
    bankLogo: "/payment-logos/tbc.png",
    bankAlt: "TBC Bank",
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
            className="flex items-center gap-3 rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
          >
            <RadioGroupItem value={m.value} id={`pay-${m.value}`} />
            <Label
              htmlFor={`pay-${m.value}`}
              className="cursor-pointer flex-1 flex flex-wrap items-center gap-x-4 gap-y-2"
            >
              <img
                src={m.bankLogo}
                alt={m.bankAlt}
                className="h-8 md:h-10 w-auto object-contain shrink-0"
                loading="lazy"
              />
              <span className="sr-only">
                {m.label} — {m.desc}
              </span>
              <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                {m.cards.map((c) => (
                  <img
                    key={c.alt}
                    src={c.src}
                    alt={c.alt}
                    title={c.alt}
                    className="h-5 md:h-6 w-auto object-contain"
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
