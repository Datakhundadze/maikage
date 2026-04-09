import { useState, useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft, ArrowRight } from "lucide-react";

const BASE = "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport";

const SLIDES = [
  `${BASE}/jersey-1.png`,
  `${BASE}/jersey-2.png`,
  `${BASE}/jersey-3.png`,
  `${BASE}/jersey-4.png`,
];

export default function SportPage() {
  const { setMode } = useAppState();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setCurrent((c) => (c + 1) % SLIDES.length), 2500);
    return () => clearInterval(id);
  }, []);

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
        {/* Hero text */}
        <div className="max-w-2xl mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">
            🏆 სპორტული ფორმები — შენი გუნდის იდენტობა
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed mb-6">
            გუნდი მხოლოდ მოთამაშეები არ არის — გუნდი არის სტილი, ერთიანობა და სული. maika.ge გთავაზობთ პროფესიონალური სპორტული ფორმების დამზადებას უმაღლესი ხარისხის ქსოვილისგან, ინდივიდუალური ბრენდინგით — მოედნიდან ტრიბუნამდე.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground mb-8">
            <li>✦ უმაღლესი ხარისხის სუნთქვადი სპორტული ქსოვილი — კომფორტი ყველაზე ინტენსიური თამაშის დროსაც</li>
            <li>✦ რეცხვაგამძლე ბეჭდვა — ფერი და სიცხადე დიდხანს შენარჩუნებული</li>
            <li>✦ სრული პერსონალიზაცია — კლუბის ლოგო, მოთამაშის გვარი და ნომერი, ოფიციალური ფონტები</li>
            <li>✦ სპონსორის ლოგოს ბეჭდვა — პროფესიონალური განთავსება ფორმის ნებისმიერ ადგილზე</li>
            <li>✦ ნებისმიერი რაოდენობა — 1 ცალიდან</li>
          </ul>

          {/* Slideshow */}
          <div className="flex flex-col items-center mb-8">
            <div className="relative max-w-xs w-full aspect-[3/4] rounded-2xl bg-muted border border-border overflow-hidden">
              {SLIDES.map((src, i) => (
                <img
                  key={src}
                  src={src}
                  alt={`სპორტული ფორმა ${i + 1}`}
                  className="absolute inset-0 w-full h-full object-contain p-2 transition-opacity duration-700 ease-in-out"
                  style={{ opacity: i === current ? 1 : 0 }}
                />
              ))}
            </div>
            {/* Dots */}
            <div className="flex gap-2 mt-3">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  className={`h-2 w-2 rounded-full transition-colors ${i === current ? "bg-[#25B988]" : "bg-muted-foreground/30"}`}
                />
              ))}
            </div>
          </div>

          <button
            onClick={() => setMode("simple")}
            className="inline-flex items-center gap-2 rounded-xl bg-[#25B988] hover:bg-[#1ea876] text-white font-semibold px-6 py-3 text-sm transition-colors"
          >
            შეკვეთა <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
