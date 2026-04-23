import { useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { ArrowLeft } from "lucide-react";

export default function AboutPage() {
  const { setMode } = useAppState();

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const onPop = () => setMode("landing");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setMode]);

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
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Brand mark */}
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-lg font-black">
            M
          </div>
          <span className="text-xl font-bold">maika.ge</span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-bold mb-10">ჩვენი შესახებ</h1>

        <div className="space-y-6 text-base leading-[1.9] text-muted-foreground">
          <p>
            Maika.ge დაარსდა 2009 წელს, როდესაც შევნიშნეთ არსებული პრობლემა ბაზარზე: არ არსებობდა
            მომსახურება, სადაც მომხმარებელს შეეძლო საკუთარი დიზაინის მაისურის სწრაფად და ადვილად
            დამზადება.
          </p>
          <p>
            ამ გამოწვევამ ჩვენ შემოქმედებითად აზროვნებისკენ გვიბიძგა — დაარსდა პირველი ონლაინ
            სერვისი საქართველოში, სადაც მომხმარებელი ვებ-გვერდზე ატვირთავდა სასურველ ნახაზს, ხოლო
            კომპანია ამზადებდა მის მიხედვით მაისურს.
          </p>
          <p>
            იდეის განხორციელების წარმატებამ განაპირობა მომხმარებელთა რიცხვისა და მოთხოვნის სწრაფი
            ზრდა. ეს კი გახდა საფუძველი კომპანიის გუნდის, ტექნოლოგიური ბაზისა და გამოცდილების
            ზრდისა.
          </p>
          <p>
            რამდენიმე წლის შემდეგ დავიწყეთ ადგილობრივი წარმოება, რათა უფრო ეფექტურად
            დაგვეკმაყოფილებინა ბაზრის მოთხოვნები.
          </p>
          <p className="text-foreground font-medium">
            დღეს maika.ge არის ინოვაციური, დინამიურად მზარდი კომპანია, რომელიც ორიენტირებულია
            თანამედროვე ტექნოლოგიების დანერგვასა და მომხმარებლის მოლოდინების გადაჭარბებაზე.
          </p>
          <p>
            ჩვენი გუნდისთვის პრიორიტეტულია მომხმარებელთან პირდაპირი კომუნიკაცია, მათი საჭიროებების
            გაგება და ინდივიდუალური მიდგომის შეთავაზება. ვცდილობთ შევქმნათ მაღალი ნდობა და
            გრძელვადიანი ურთიერთობა მათთან ხელმისაწვდომ ფასად.
          </p>
        </div>

        {/* Year badge */}
        <div className="mt-12 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-sm font-medium">2009 წლიდან</span>
        </div>
      </div>
    </div>
  );
}
