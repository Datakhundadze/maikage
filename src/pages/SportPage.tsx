import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft } from "lucide-react";

export default function SportPage() {
  const { setMode } = useAppState();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => setMode("landing")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> მთავარი
        </button>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-2">
          <div className="h-1 w-6 rounded-full bg-[#25B988]" />
          <span className="text-xs font-semibold text-[#25B988] uppercase tracking-wider">SPORT</span>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12">
        <h1 className="text-3xl sm:text-4xl font-bold mb-4">სპორტული განყოფილება</h1>
        <p className="text-muted-foreground text-base mb-12 max-w-2xl">
          სპორტული მაისურები, ფორმები და სპეციალური კოლექციები. ტექსტი და ფოტოები მალე დაემატება.
        </p>

        {/* Photo grid placeholder */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[3/4] rounded-2xl bg-muted border border-border flex items-center justify-center"
            >
              <span className="text-muted-foreground/40 text-sm">ფოტო {i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
