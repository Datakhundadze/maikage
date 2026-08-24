import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";

// "bog" is retained ONLY so historical orders (payment_provider = "bog") and
// the still-live BOG callback/status code keep typechecking — Bank of Georgia
// is no longer offered at checkout (METHODS below lists TBC/Flitt only).
export type PaymentMethod = "bog" | "tbc";

// width/height match each PNG's intrinsic aspect (scaled-down) so the
// browser reserves a stable box during image load → zero CLS as the
// payment radio panel renders.
type CardLogo = { src: string; alt: string; width: number; height: number };

const CARD_VISA: CardLogo = { src: "/payment-logos/visa.png", alt: "Visa", width: 192, height: 62 };
const CARD_MC: CardLogo = { src: "/payment-logos/mastercard.png", alt: "Mastercard", width: 192, height: 149 };
const CARD_APPLE: CardLogo = { src: "/payment-logos/apple-pay.png", alt: "Apple Pay", width: 32, height: 32 };
const CARD_GPAY: CardLogo = { src: "/payment-logos/google-pay.png", alt: "Google Pay", width: 84, height: 86 };

// THE ACQUIRER'S LOGO IS NOT A CARD RESTRICTION, and customers read it as one.
// The row used to lead with the TBC bank mark, which answers a question nobody
// asked ("who processes this?") while implying an answer to the one they do
// ("will my card work?") — and implying it WRONGLY, since any Visa or
// Mastercard is accepted whoever the acquirer is. The card marks now carry the
// row; they are the actual answer. `value` is untouched, so nothing about
// provider selection or routing changes — this is presentation only.
const METHODS: {
  value: PaymentMethod;
  label: string;
  desc: string;
  cards: CardLogo[];
}[] = [
  {
    value: "tbc",
    label: "TBC",
    desc: "ბარათით გადახდა",
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
              {/* Where the bank mark used to sit. Without a word here the row
                  would be four small logos and nothing else; `desc` already
                  said "pay by card" to screen readers only. */}
              <span className="text-sm font-medium text-foreground shrink-0">{m.desc}</span>
              <span className="sr-only">{m.label}</span>
              <div className="flex items-center gap-1 sm:gap-1.5 ml-auto flex-nowrap shrink-0">
                {m.cards.map((c) => (
                  <img
                    key={c.alt}
                    src={c.src}
                    alt={c.alt}
                    title={c.alt}
                    width={c.width}
                    height={c.height}
                    className="h-5 sm:h-6 w-auto object-contain shrink-0"
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
