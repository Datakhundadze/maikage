import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft } from "lucide-react";
import CorporateInquiryModal from "@/components/CorporateInquiryModal";

// Placeholder slots — replace src values with real Supabase URLs after upload
const SPORT_GALLERY: { src: string; label: string }[] = [
  { src: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-white-front.png", label: "თეთრი ფორმა — წინა" },
  { src: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-black-front.png", label: "შავი ფორმა — წინა" },
  { src: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-white-back.png", label: "თეთრი ფორმა — უკანა" },
  { src: "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-black-back.png", label: "შავი ფორმა — უკანა" },
];

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
          <CorporateInquiryModal>
            <button className="inline-flex items-center gap-2 rounded-xl bg-[#25B988] hover:bg-[#1ea876] text-white font-semibold px-6 py-3 text-sm transition-colors">
              დაგვიკავშირდით
            </button>
          </CorporateInquiryModal>
        </div>

        {/* Photo gallery */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {SPORT_GALLERY.map((item) => (
            <div key={item.src} className="flex flex-col gap-2">
              <div className="aspect-[3/4] rounded-2xl bg-muted border border-border overflow-hidden flex items-center justify-center">
                <img
                  src={item.src}
                  alt={item.label}
                  className="w-full h-full object-contain p-2"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              </div>
              <span className="text-xs text-muted-foreground text-center">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
