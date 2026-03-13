import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  const { setMode, theme } = useAppState();

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

        <h1 className="text-3xl font-bold mb-8">წესები და პირობები</h1>

        <div className="prose prose-gray dark:prose-invert max-w-none text-gray-600 dark:text-white/60 leading-relaxed space-y-4">
          <p>კონტენტი მალე დაემატება.</p>
        </div>
      </div>
    </div>
  );
}
