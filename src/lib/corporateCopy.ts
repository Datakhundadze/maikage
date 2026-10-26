// /corporate — the SEO text section and the page's <title> / description.
//
// ONE SOURCE for the live page (pages/CorporatePage.tsx: SeoHead + the
// section, rendered by components/landing/LandingCopySection) and the static
// prerender (scripts/prerender.mjs → dist/corporate/index.html, which loads
// this module through scripts/lib/appModules.mjs). Text is owner-approved —
// keep it verbatim.
//
// No prices, no currency sign and no production lead time in this file, by
// rule (src/test/corporateCopy.test.tsx checks it). Quantities ("10 ცალიდან")
// are not prices.
import type { LandingCopy } from "@/lib/landingCopy";

export const CORPORATE_SEO = {
  title: "მაისურების ბრენდირება კომპანიის ლოგოთი — კორპორატიული შეკვეთები | Maika.ge",
  description:
    "ბრენდირებული მაისურები, ჰუდები, ჩანთები და კეპები კომპანიებისა და გუნდებისთვის. DTF ბეჭდვა, შელკოგრაფია, ქარგვა და FLEX. 10 ცალიდან ფასდაკლება. თბილისი, დინამოს სტადიონი.",
} as const;

export const CORPORATE_COPY: LandingCopy = {
  h2: "მაისურების ბრენდირება კომპანიის ლოგოთი",
  intro:
    "ვამზადებთ ბრენდირებულ მაისურებს, ჰუდებს, ჩანთებს, კეპებს და წინსაფრებს კომპანიებისთვის, ღონისძიებებისა და გუნდებისთვის. შენ ლოგოს გვიგზავნი, მაკეტს, ბეჭდვას და შეფუთვას ჩვენ ვაკეთებთ.",
  sections: [
    {
      h3: "ბრენდირების მეთოდები",
      bullets: [
        { term: "DTF ბეჭდვა", text: "ფერადი ლოგო ან ფოტო ნებისმიერ რაოდენობაზე, ერთი ცალიდანაც." },
        { term: "შელკოგრაფია", text: "დიდი ტირაჟისთვის. რაც მეტია რაოდენობა, მით იაფია ერთი ცალი." },
        { term: "ქარგვა", text: "დიდი რაოდენობისთვის. პრემიუმ იერი პოლოებზე, ჰუდებზე და კეპებზე." },
        {
          term: "თერმული ბეჭდვა (FLEX)",
          text: "გვარები, ნომრები და ერთფეროვანი ლოგოები, განსაკუთრებით სპორტული ფორმებისთვის.",
        },
      ],
      link: { href: "/maisurebze-bechdva", label: "მაისურებზე ბეჭდვა" },
    },
    {
      h3: "სპორტული ფორმები გუნდებისთვის",
      body: "ფორმებს ვკერავთ ინდივიდუალურად, თითოეულ გუნდზე. ვბეჭდავთ გვარს და ნომერს.",
      link: { href: "/sportuli-formebi", label: "სპორტული ფორმები გვარით და ნომრით" },
    },
    {
      h3: "ფასი და ვადა",
      body: "10 ცალიდან ფასდაკლებაა. ვადა დამოკიდებულია ბრენდირების მეთოდსა და რაოდენობაზე. ზუსტ ფასს და ვადას შეკვეთისას შეგითანხმებთ.",
    },
    {
      h3: "ვისთან ვთანამშრომლობთ",
      body: "ვართ დინამო თბილისის ოფიციალური პარტნიორი, ვთანამშრომლობთ Nike-ის ოფიციალურ წარმომადგენლობასთან საქართველოში და ვამზადებთ ბრენდირებულ პროდუქციას საერთაშორისო და ქართული ბრენდებისთვის.",
      link: { href: "/portfolio", label: "პორტფოლიო" },
    },
  ],
};
