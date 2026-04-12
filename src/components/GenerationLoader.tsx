import { useState, useEffect } from "react";
import type { AppStatus } from "@/hooks/useDesign";
import { useAppState } from "@/hooks/useAppState";

interface GenerationLoaderProps {
  status: AppStatus;
}

const STATUS_INFO: Record<string, { title: string; log: string }> = {
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

const FUN_FACTS_GE = [
  "👕 პირველი მაისური 1904 წელს გამოჩნდა — ამერიკელ სამხედროებს ეცვათ.",
  "🧵 ყოველწლიურად მსოფლიოში 2 მილიარდზე მეტი მაისური იყიდება.",
  "🏭 საშუალო მაისურს 2,700 ლიტრი წყალი სჭირდება წარმოებისთვის.",
  "🎨 პირველი ბეჭდური მაისური 1948 წელს შეიქმნა — Thomas Dewey-ს კამპანიაში.",
  "👕 სიტყვა 'T-Shirt' პირველად 1920 წელს გამოიყენა F. Scott Fitzgerald-მა.",
  "🧥 ჰუდი 1930-იან წლებში გამოჩნდა — სუსხიან საწყობებში მომუშავე მუშებისთვის.",
  "🎭 Rocky Balboa-ს ჰუდი 1976 წელს კინოდ ხდება კულტ ნივთი.",
  "👟 Champion-მა პირველი ჰუდი 1930-ში შეშქმნა სპორტსმენებისთვის.",
  "🌍 ბამბის ყველაზე დიდი მწარმოებელი ჩინეთია — წელიწადში 7 მლნ ტონა.",
  "🖨️ DTG ბეჭდვის ტექნოლოგია 1990-იან წლებში გამოჩნდა.",
  "♻️ გადამუშავებული ბამბა 20%-ით ნაკლებ ენერგიას მოითხოვს.",
  "🏆 ყველაზე ძვირი T-Shirt — Supima ბამბის, $400,000-ად გაიყიდა.",
  "🤖 AI-ბეჭდვა ბოლო 5 წელში 300%-ით გაიზარდა მსოფლიოში.",
  "🎸 როლინგ სტოუნსის 1972 წლის ტური პირველია, ვინც ოფიციალური ჯგუფის მაისური გაყიდა.",
  "👶 პირველი ბავშვის მაისური 1950-იანებში შეიქმნა — კომფორტისთვის.",
];

const FUN_FACTS_EN = [
  "👕 The T-shirt first appeared in 1904 — worn by American soldiers.",
  "🧵 Over 2 billion T-shirts are sold worldwide every year.",
  "🏭 An average T-shirt requires 2,700 liters of water to produce.",
  "🎨 The first printed T-shirt was made in 1948 for Thomas Dewey's campaign.",
  "👕 The word 'T-Shirt' was first used by F. Scott Fitzgerald in 1920.",
  "🧥 Hoodies appeared in the 1930s — made for workers in freezing warehouses.",
  "🎭 Rocky Balboa's hoodie became a cult item after the 1976 film.",
  "👟 Champion created the first hoodie in 1930 for athletes.",
  "🌍 China is the largest cotton producer — 7 million tons per year.",
  "🖨️ DTG printing technology emerged in the 1990s.",
  "♻️ Recycled cotton requires 20% less energy to produce.",
  "🏆 The most expensive T-shirt — made of Supima cotton — sold for $400,000.",
  "🤖 AI-powered printing grew 300% worldwide in the last 5 years.",
  "🎸 The Rolling Stones 1972 tour was the first to sell official band T-shirts.",
  "👶 The first children's T-shirt was created in the 1950s for comfort.",
];

export default function GenerationLoader({ status }: GenerationLoaderProps) {
  const { lang } = useAppState();
  const info = STATUS_INFO[status];
  const facts = lang === "en" ? FUN_FACTS_EN : FUN_FACTS_GE;

  const [factIdx, setFactIdx] = useState(() => Math.floor(Math.random() * facts.length));
  const [visible, setVisible] = useState(true);

  // Rotate facts every 4 seconds with a fade effect
  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setFactIdx((i) => (i + 1) % facts.length);
        setVisible(true);
      }, 400);
    }, 4000);
    return () => clearInterval(interval);
  }, [facts.length]);

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

      {/* Fun fact */}
      <div
        className="rounded-xl border border-border bg-card/50 px-5 py-4 text-center transition-opacity duration-400 max-w-xs"
        style={{ opacity: visible ? 1 : 0, transition: "opacity 0.4s ease" }}
      >
        <p className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-1 font-semibold">
          {lang === "en" ? "Did you know?" : "იცოდი?"}
        </p>
        <p className="text-sm text-foreground/80 leading-relaxed">
          {facts[factIdx]}
        </p>
      </div>
    </div>
  );
}
