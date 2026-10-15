import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQ_GROUPS, FAQ_PAGE } from "@/lib/faqContent";

// FAQPage schema, derived once at module load from the same FAQ_GROUPS
// (lib/faqContent.ts). No text duplication — edit a question or answer in FAQ_GROUPS
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
        title={FAQ_PAGE.title}
        description={FAQ_PAGE.description}
        url={`${SITE_URL}/faq`}
        schemas={[FAQ_SCHEMA]}
      />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          {FAQ_PAGE.backLabel}
        </button>

        <h1 className="text-3xl font-bold mb-2">{FAQ_PAGE.h1}</h1>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed mb-10">
          {FAQ_PAGE.intro}
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
