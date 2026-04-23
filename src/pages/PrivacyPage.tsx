import { useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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

        <h1 className="text-3xl font-bold mb-8">კონფიდენციალურობის პოლიტიკა</h1>

        <div className="prose prose-gray dark:prose-invert max-w-none text-gray-600 dark:text-white/60 leading-relaxed space-y-4">
          <p>
            თქვენი პერსონალური ინფორმაცია უმთავრესად გამოიყენება მომხმარებლის იდენტიფიკაციისთვის,
            საკონტაქტოდ, შეკვეთის დეტალების დასადგენად და მცირე რისკების თავიდან აცილებისთვის.
            ჩვენთან ყველა ინფორმაცია დაცულია.
          </p>
          <p>
            შპს 'MAIKA.GE' იღებს პასუხისმგებლობას, რომ თქვენს მიერ გამჟღავნებული პერსონალური
            ინფორმაცია არ იქნება გამოყენებული ჩვენს მიერ კანონით აკრძალული მიზნებისათვის.
          </p>
        </div>
      </div>
    </div>
  );
}
