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
          // MATCHES THE DELIVERY ROWS ABOVE, which are the reference: same
          // rounded-lg, same border-border, same hover:bg-accent/50, and — the
          // point of this — NO background of its own, so it takes the form's.
          //
          // It used to carry a hardcoded bg-[hsl(0_0%_92%)] / 96%, a fixed light
          // grey that ignored the theme. That was invisible while the only thing
          // on the row was logos; the moment a word appeared next to them,
          // `text-foreground` resolved light in dark mode and vanished against
          // it. Theme tokens on both, so the two can never disagree again.
          //
          // SELECTED still reads as chosen, not disabled: border-primary plus
          // the same primary/5 wash the price summary in this dialog already
          // uses. There is one method today, so this is the state customers
          // actually see — it has to look picked.
          <div
            key={m.value}
            className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
              value === m.value
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-accent/50"
            }`}
          >
            <RadioGroupItem value={m.value} id={`pay-${m.value}`} />
            <Label
              htmlFor={`pay-${m.value}`}
              className="cursor-pointer flex-1 min-w-0 flex items-center gap-2 flex-wrap"
            >
              {/* Where the bank mark used to sit. Without a word here the row
                  would be four small logos and nothing else; `desc` already
                  said "pay by card" to screen readers only. */}
              <span className="text-sm font-normal text-foreground shrink-0">{m.desc}</span>
              <span className="sr-only">{m.label}</span>
              {/* THE MARKS KEEP THEIR OWN LIGHT GROUND, and only they do.
                  public/payment-logos holds one artwork per brand — dark Visa
                  lettering, a black Apple Pay glyph, dark "G Pay" — all drawn
                  for a light backing, and there are no dark-mode variants to
                  switch to. Lightening the whole row to suit them is what broke
                  the label, so the light stays under the logos and nowhere
                  else. White rather than a token because these are brand marks
                  specified against white; the hairline ring keeps the chip from
                  floating on a light theme, where it sits on near-white. */}
              <span className="ml-auto flex items-center gap-1 sm:gap-1.5 rounded-md bg-white px-1.5 py-1 ring-1 ring-black/10 shrink-0">
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
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}
