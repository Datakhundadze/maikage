import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import FaqPage from "@/pages/FaqPage";
import { SUB_PRODUCTS } from "@/lib/catalog";
import { PRICES } from "@/lib/pricing";
import { BAG_FEE } from "@/lib/fees";
import {
  FAQ_DELIVERY_PRICES,
  FAQ_GROUPS,
  FAQ_HOODIE_BRANDS,
  FAQ_PRODUCT_KEYS,
  FAQ_TSHIRT_BRANDS,
  FAQ_CATALOG_PROMO_SENTENCE,
  type FaqBrand,
} from "@/lib/faqContent";

// The FAQ's prices (lib/faqContent.ts) against their sources: pricing.ts
// PRICES (what calculatePrice charges), OrderDialog.tsx DELIVERY_PRICES and
// fees.ts BAG_FEE. None of the expected numbers below is typed by hand.

const ROOT = path.resolve(__dirname, "../..");
const source = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const ALL = FAQ_GROUPS.flatMap((g) => g.items);
const answer = (q: string) => {
  const item = ALL.find((i) => i.q === q);
  if (!item) throw new Error(`FAQ question missing: ${q}`);
  return item.a;
};

const TSHIRT_Q = "რა ღირს მაისურზე ბეჭდვა?";
const HOODIE_Q = "რა ღირს ჰუდი?";
const TSHIRT_TAIL = ". ფასში შედის ცალმხრივი A4 ბეჭდვა. ორმხრივი ბეჭდვა: +10₾ პატარა წარწერა ან ლოგო, +15₾ დიდი პრინტი." + FAQ_CATALOG_PROMO_SENTENCE;
const HOODIE_TAIL = ". დაუთბილავი ჰუდი — 85₾, შეზღუდული ფერები და ზომები, მხოლოდ შოურუმში. ფასში შედის ბეჭდვა.";

/** "GILDAN 35₾, TH 45₾" → [["GILDAN", 35], ["TH", 45]] */
function parseBrandList(list: string): [string, number][] {
  return list.split(", ").map((part) => {
    const m = /^(.+) (\d+)₾$/.exec(part);
    if (!m) throw new Error(`not "<name> <n>₾": ${part}`);
    return [m[1], Number(m[2])];
  });
}

function brandAnswerCase(q: string, tail: string, brands: readonly FaqBrand[], catalogKeys: string[]) {
  const a = answer(q);

  it("every catalog brand is listed exactly once, under its customer-facing name", () => {
    expect([...brands.map(([k]) => k)].sort()).toEqual([...catalogKeys].sort());
    expect(new Set(brands.map(([, label]) => label)).size).toBe(brands.length);
  });

  it("every brand price equals pricing.ts PRICES[brand].frontOnly", () => {
    expect(a.endsWith(tail)).toBe(true);
    const parsed = parseBrandList(a.slice(0, -tail.length));
    expect(parsed).toEqual(brands.map(([key, label]) => [label, PRICES[key].frontOnly]));
  });

  it("the only other numbers are the owner-confirmed literal tail", () => {
    const tailNumbers = [...tail.matchAll(/(\d+)₾/g)].map((m) => Number(m[1]));
    const allNumbers = [...a.matchAll(/(\d+)₾/g)].map((m) => Number(m[1]));
    expect(allNumbers).toEqual([...brands.map(([key]) => PRICES[key].frontOnly), ...tailNumbers]);
  });
}

describe("T-shirt answer", () => {
  brandAnswerCase(TSHIRT_Q, TSHIRT_TAIL, FAQ_TSHIRT_BRANDS, SUB_PRODUCTS["T-Shirt"]);

  it("uses the agreed names, in the agreed order", () => {
    expect(FAQ_TSHIRT_BRANDS.map(([, label]) => label)).toEqual([
      "GILDAN", "TH", "Polo", "Sol's", "პრემიუმ ხარისხის", "GIORDANO", "Oversize", "მოხარშული ნაჭარი", "Khundadze", "NIKE", "GILDAN KIDS (საბავშვო)",
    ]);
    expect(Object.fromEntries(FAQ_TSHIRT_BRANDS)).toMatchObject({ "GILDAN HUMMER": "პრემიუმ ხარისხის", "JEL T-Shirt": "მოხარშული ნაჭარი" });
  });

  it("the literal +10₾ / +15₾ second-side sentence still matches every T-shirt's price tier", () => {
    for (const [key] of FAQ_TSHIRT_BRANDS) {
      expect(PRICES[key].backText - PRICES[key].frontOnly, key).toBe(10);
      expect(PRICES[key].backPhoto - PRICES[key].frontOnly, key).toBe(15);
    }
  });

  it("Polo appears once in the whole FAQ, at its pricing.ts price", () => {
    const text = ALL.map((i) => `${i.q}\n${i.a}`).join("\n");
    expect(text.match(/Polo/g)).toHaveLength(1);
    expect(answer(TSHIRT_Q)).toContain(`Polo ${PRICES.Polo.frontOnly}₾,`);
  });
});

describe("hoodie answer", () => {
  brandAnswerCase(HOODIE_Q, HOODIE_TAIL, FAQ_HOODIE_BRANDS, SUB_PRODUCTS["Hoodie"]);

  it("uses the agreed names, in the agreed order", () => {
    expect(FAQ_HOODIE_BRANDS).toEqual([
      ["GILDAN Hoodie", "GILDAN"],
      ["JEL Standard Hoodie", "JEL"],
      ["JEL Standard Zipper", "JEL ელვიანი"],
      ["Premium Washed Hoodie", "მოხარშული ნაჭარი"],
      ["JEL Zipper", "ელვიანი მოხარშული"],
      ["GILDAN Bomber", "GILDAN Bomber"],
    ]);
  });
});

describe("single-price products", () => {
  const cases: [string, string][] = [
    ["რა ღირს ქეისზე ბეჭდვა?", FAQ_PRODUCT_KEYS.phoneCase],
    ["რა ღირს ჭიქაზე ბეჭდვა?", FAQ_PRODUCT_KEYS.mug],
    ["რა ღირს ნაჭრის ჩანთაზე ბეჭდვა?", FAQ_PRODUCT_KEYS.tote],
    ["რა ღირს კეპზე ბეჭდვა?", FAQ_PRODUCT_KEYS.cap],
    ["რა ღირს წინსაფარზე ბეჭდვა?", FAQ_PRODUCT_KEYS.apron],
  ];
  for (const [q, key] of cases) {
    it(`${q} = PRICES["${key}"].frontOnly`, () => {
      expect(PRICES[key]).toBeDefined();
      expect(answer(q)).toBe(`${PRICES[key].frontOnly}₾ სასურველი პრინტით.`);
    });
  }

  it("cap and apron follow the tote, before the A3 question", () => {
    const qs = FAQ_GROUPS[0].items.map((i) => i.q);
    const tote = qs.indexOf("რა ღირს ნაჭრის ჩანთაზე ბეჭდვა?");
    expect(qs.slice(tote, tote + 4)).toEqual([
      "რა ღირს ნაჭრის ჩანთაზე ბეჭდვა?",
      "რა ღირს კეპზე ბეჭდვა?",
      "რა ღირს წინსაფარზე ბეჭდვა?",
      "A4-ზე დიდი პრინტი შეიძლება?",
    ]);
  });
});

describe("delivery and bag fee", () => {
  it("FAQ_DELIVERY_PRICES equals OrderDialog.tsx DELIVERY_PRICES (read from its source)", () => {
    const src = source("src/components/OrderDialog.tsx");
    const block = /const DELIVERY_PRICES: Record<DeliveryType, number> = \{([^}]*)\};/.exec(src);
    expect(block, "DELIVERY_PRICES not found in OrderDialog.tsx").not.toBeNull();
    const entries = Object.fromEntries(
      [...block![1].matchAll(/(\w+):\s*(\d+(?:\.\d+)?)/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(entries.courier_tbilisi).toBe(FAQ_DELIVERY_PRICES.courier_tbilisi);
    expect(entries.courier_outside).toBe(FAQ_DELIVERY_PRICES.courier_outside);
  });

  it("BAG_FEE is the fees.ts value the checkout adds", () => {
    expect(source("src/lib/fees.ts")).toContain(`export const BAG_FEE = ${BAG_FEE};`);
  });

  it("the delivery answer quotes those numbers", () => {
    expect(answer("მთელ საქართველოში აგზავნით?")).toBe(
      `დიახ. საკურიერო მომსახურება თბილისში ${FAQ_DELIVERY_PRICES.courier_tbilisi}₾, თბილისს გარეთ ${FAQ_DELIVERY_PRICES.courier_outside}₾. კურიერი კარზე მოგაწვდით. ონლაინ შეკვეთას ემატება ${BAG_FEE}₾ შეფუთვის საფასური.`,
    );
  });
});

describe("owner-confirmed literal service prices are unchanged", () => {
  it.each([
    ["A4-ზე დიდი პრინტი შეიძლება?", "დიახ, მაქსიმუმ A3 ფორმატამდე, +10/15₾ ზომის მიხედვით."],
    ["ბეჭდავთ თუ არა სპორტულ მაისურზე გვარს და ნომერს?", "დიახ, 20₾ სასურველი გვარითა და ნომრით."],
    ["სასწრაფოდ შეიძლება მიღება?", "დიახ, ექსპრეს კურიერი 12₾. 15:00-მდე გაფორმებული შეკვეთა იმავე დღეს იგზავნება."],
    ["შეიძლება ჩემი მაისური/ჰუდი მოვიტანო ბეჭდვისთვის?", "დიახ, A4 პრინტი 20₾. გაითვალისწინეთ — მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ."],
  ])("%s", (q, a) => {
    expect(answer(q)).toBe(a);
  });
});

describe("live /faq renders every Q&A from FAQ_GROUPS", () => {
  it("each question and its expanded answer, in order", () => {
    const { container } = render(
      <HelmetProvider>
        <MemoryRouter initialEntries={["/faq"]}>
          <FaqPage />
        </MemoryRouter>
      </HelmetProvider>,
    );
    const triggers = [...container.querySelectorAll("button[aria-expanded]")];
    expect(triggers.map((t) => t.textContent)).toEqual(ALL.map((i) => i.q));
    for (const t of triggers) fireEvent.click(t);
    const answers = [...container.querySelectorAll('[role="region"]')].map((r) => r.textContent);
    expect(answers).toEqual(ALL.map((i) => i.a));
    expect(container.textContent).not.toContain("undefined");
  });
});
