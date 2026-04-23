import { useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft, ArrowRight, Shield, Zap, Users, BadgeDollarSign } from "lucide-react";
import CorporateInquiryModal from "@/components/CorporateInquiryModal";

export default function CorporatePage() {
  const { setMode } = useAppState();

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => setMode("landing");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setMode]);

  return (
    <div className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <button
          onClick={() => setMode("landing")}
          className="inline-flex items-center gap-2 text-sm text-gray-500 dark:text-white/40 hover:text-gray-900 dark:hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          მთავარი გვერდი
        </button>

        <h1 className="text-3xl font-bold mb-4">კორპორატიული განყოფილება</h1>
        <p className="text-gray-500 dark:text-white/50 leading-relaxed mb-8">
          გთავაზობთ კორპორატიულ მომსახურებას — ბრენდირებული ტანსაცმელი, აქსესუარები და სარეკლამო პროდუქცია თქვენი კომპანიისთვის. ინდივიდუალური მიდგომა ყველა პროექტისთვის.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-8">
          {[
            { icon: Shield, label: "ხარისხი" },
            { icon: Zap, label: "სისწრაფე" },
            { icon: Users, label: "ინდივიდუალური მიდგომა" },
            { icon: BadgeDollarSign, label: "კონკურენტული ფასები" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
                <Icon className="h-5 w-5 text-amber-500" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        <CorporateInquiryModal>
          <button className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold px-6 py-3 text-sm transition-colors">
            დაგვიკავშირდი <ArrowRight className="h-4 w-4" />
          </button>
        </CorporateInquiryModal>
      </div>
    </div>
  );
}
