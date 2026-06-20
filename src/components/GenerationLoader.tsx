import type { AppStatus } from "@/hooks/useDesign";
import { useAppState } from "@/hooks/useAppState";

interface GenerationLoaderProps {
  status: AppStatus;
}

const STATUS_INFO_EN: Record<string, { title: string; log: string }> = {
  GENERATING_DESIGN: {
    title: "Generative Design",
    log: "Assembling prompt → sending to AI model...",
  },
  PROCESSING_TRANSPARENCY: {
    title: "Processing Alpha...",
    log: "Difference matting → extracting transparency...",
  },
  GENERATING_MOCKUP: {
    title: "Virtual Photography",
    log: "Compositing design onto product photo...",
  },
};

const STATUS_INFO_GE: Record<string, { title: string; log: string }> = {
  GENERATING_DESIGN: {
    title: "AI დიზაინი",
    log: "პრომპტის მომზადება → AI მოდელზე გაგზავნა...",
  },
  PROCESSING_TRANSPARENCY: {
    title: "Alpha დამუშავება...",
    log: "ფონის მოცილება → გამჭვირვალობის გამოყოფა...",
  },
  GENERATING_MOCKUP: {
    title: "ვირტუალური ფოტოგრაფია",
    log: "დიზაინი ედება პროდუქტის ფოტოს...",
  },
};

export default function GenerationLoader({ status }: GenerationLoaderProps) {
  const { lang } = useAppState();
  const statusInfo = lang === "en" ? STATUS_INFO_EN : STATUS_INFO_GE;
  const info = statusInfo[status];

  if (!info) return null;

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8 max-w-md mx-auto">
      {/* Spinner */}
      <div className="relative flex h-24 w-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        <span className="text-sm font-bold text-primary">AI</span>
      </div>

      {/* Status */}
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{info.title}</h3>
        <p className="text-xs font-mono text-muted-foreground animate-pulse">{info.log}</p>
      </div>

      {/* Step indicators */}
      <div className="flex gap-2">
        {["GENERATING_DESIGN", "PROCESSING_TRANSPARENCY", "GENERATING_MOCKUP"].map((step, i) => {
          const steps = ["GENERATING_DESIGN", "PROCESSING_TRANSPARENCY", "GENERATING_MOCKUP"];
          const currentIdx = steps.indexOf(status);
          const isActive = i === currentIdx;
          const isDone = i < currentIdx;
          return (
            <div
              key={step}
              className={`h-1.5 w-8 rounded-full transition-colors ${
                isDone ? "bg-primary" : isActive ? "bg-primary animate-pulse" : "bg-muted"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}
