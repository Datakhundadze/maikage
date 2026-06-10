import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface FaqItem {
  q: string;
  a: string;
}

interface FaqGroup {
  heading: string;
  items: FaqItem[];
}

// Single source of truth for both the rendered accordion and the
// FAQPage JSON-LD below. Keep questions and answers verbatim — these
// are the brand-approved phrasings used by the storefront.
const FAQ_GROUPS: FaqGroup[] = [
  {
    heading: "ფასები — ბეჭდვა",
    items: [
      {
        q: "რა ღირს მაისურზე ბეჭდვა?",
        a: "GILDAN 35₾, TH clothes 45₾, Polo (JEL) 45₾, Polo (TH clothes) 50₾, SOL'S 50₾, პრემიუმ ხარისხის 60₾, GIORDANO 70₾, oversize 70₾, მოხარშული ნაჭარი 70₾. ფასში შედის ცალმხრივი A4 ბეჭდვა. ორმხრივი ბეჭდვა +10/15₾ პრინტის ზომის მიხედვით.",
      },
      {
        q: "რა ღირს ჰუდი?",
        a: "GILDAN 80₾, JEL 85₾, დაუთბილავი 85₾, JEL ელვიანი 95₾, მოხარშული ნაჭარი 95₾, ელვიანი მოხარშული 105₾. ფასში შედის ბეჭდვა.",
      },
      {
        q: "რა ღირს ქეისზე ბეჭდვა?",
        a: "20₾ სასურველი პრინტით.",
      },
      {
        q: "რა ღირს ჭიქაზე ბეჭდვა?",
        a: "25₾ სასურველი პრინტით.",
      },
      {
        q: "რა ღირს ნაჭრის ჩანთაზე ბეჭდვა?",
        a: "35₾ სასურველი პრინტით.",
      },
      {
        q: "A4-ზე დიდი პრინტი შეიძლება?",
        a: "დიახ, მაქსიმუმ A3 ფორმატამდე, +10/15₾ ზომის მიხედვით.",
      },
      {
        q: "ფასდაკლება გაქვთ დიდი რაოდენობით შეკვეთაზე?",
        a: "დიახ, 10 ცალიდან ზემოთ ვრცელდება ფასდაკლება. ზუსტი ფასი დამოკიდებულია შეკვეთის დეტალებზე — დაგვიკავშირდით და შემოგთავაზებთ ინდივიდუალურ ფასს.",
      },
    ],
  },
  {
    heading: "სპორტული და კორპორატიული",
    items: [
      {
        q: "ბეჭდავთ თუ არა სპორტულ მაისურზე გვარს და ნომერს?",
        a: "დიახ, 20₾ სასურველი გვარითა და ნომრით.",
      },
      {
        q: "გაქვთ თუ არა სპორტული მაისურები?",
        a: "ვკერავთ ინდივიდუალურად სპორტული გუნდებისთვის.",
      },
    ],
  },
  {
    heading: "ვადები",
    items: [
      {
        q: "რამდენ ხანში მზადდება შეკვეთა?",
        a: "1-2 სამუშაო დღე. კონკრეტული დღისთვის თუ გჭირდებათ — მოგვწერეთ და დაგეხმარებით.",
      },
    ],
  },
  {
    heading: "მიწოდება",
    items: [
      {
        q: "მთელ საქართველოში აგზავნით?",
        a: "დიახ. საკურიერო მომსახურება თბილისში 8₾, თბილისს გარეთ 12₾. კურიერი კარზე მოგაწვდით.",
      },
      {
        q: "სასწრაფოდ შეიძლება მიღება?",
        a: "დიახ, ექსპრეს კურიერი 12₾. 15:00-მდე გაფორმებული შეკვეთა იმავე დღეს იგზავნება.",
      },
      {
        q: "შოურუმში მოსვლა და ადგილზე წაღება შეიძლება?",
        a: "დიახ. მისამართი: ა. წერეთლის #2, დინამოს სტადიონი, მე-10 კარი.",
      },
    ],
  },
  {
    heading: "დიზაინი და მასალა",
    items: [
      {
        q: "შეიძლება ჩემი მაისური/ჰუდი მოვიტანო ბეჭდვისთვის?",
        a: "დიახ, A4 პრინტი 20₾. გაითვალისწინეთ — მოტანილ ნივთზე პასუხისმგებლობას ვერ ვიღებთ.",
      },
      {
        q: "რეცხვის შემდეგ პრინტი ხომ არ წავა?",
        a: "არა. ვბეჭდავთ DTF ტექნოლოგიით — ფერი სტაბილურია, ბუნებრივი და ნათელი, პრინტი ქსოვილში ინტეგრირებული და რეცხვაგამძლეა.",
      },
      {
        q: "AI დიზაინი როგორ მუშაობს?",
        a: "Maika.ge-ის AI სტუდიაში უფასოდ შეგიძლიათ შექმნათ უნიკალური დიზაინი ხელოვნური ინტელექტით და დაბეჭდოთ მაისურზე, ჰუდიზე თუ სხვა ნივთზე.",
      },
    ],
  },
  {
    heading: "გადახდა და საათები",
    items: [
      {
        q: "როგორ ხდება გადახდა?",
        a: "საბანკო გადარიცხვით, ონლაინ, ბარათით ან ნაღდი ანგარიშსწორებით.",
      },
      {
        q: "როდის ხართ ღია?",
        a: "ორშაბათი-პარასკევი 11:00-19:00, შაბათი 11:00-18:00, კვირა არასამუშაო დღეა.",
      },
    ],
  },
];

// FAQPage schema, derived once at module load from the same FAQ_GROUPS
// above. No text duplication — edit a question or answer in FAQ_GROUPS
// and the rich-snippet payload updates automatically.
const FAQ_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_GROUPS.flatMap((g) => g.items).map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: item.a,
    },
  })),
};

export default function FaqPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <SeoHead
        title="ხშირად დასმული კითხვები (FAQ) | Maika.ge"
        description="მაისურზე და ჰუდზე ბეჭდვის ფასები, მიწოდება, ვადები, გადახდა და ხშირი კითხვები — ყველაფერი Maika.ge-ის სერვისების შესახებ ერთ გვერდზე."
        url={`${SITE_URL}/faq`}
        schemas={[FAQ_SCHEMA]}
      />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          მთავარი გვერდი
        </button>

        <h1 className="text-3xl font-bold mb-2">ხშირად დასმული კითხვები</h1>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed mb-10">
          ფასები, მიწოდება, ვადები და გადახდა — ყველაფერი ერთ გვერდზე.
        </p>

        <div className="space-y-10">
          {FAQ_GROUPS.map((group) => (
            <section key={group.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-wider mb-3 text-[#26BB89]">
                {group.heading}
              </h2>
              <Accordion type="multiple" className="w-full">
                {group.items.map((item) => (
                  <AccordionItem
                    key={item.q}
                    value={item.q}
                    className="border-gray-200 dark:border-white/10"
                  >
                    <AccordionTrigger className="text-left text-base font-medium text-gray-900 dark:text-white hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="text-gray-600 dark:text-white/60 leading-relaxed text-sm">
                      {item.a}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
