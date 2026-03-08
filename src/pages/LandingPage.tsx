import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Sparkles, Image, Type } from "lucide-react";

export default function LandingPage() {
  const { lang, setMode, toggleLang, theme, toggleTheme } = useAppState();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      {/* Top bar */}
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <button onClick={toggleLang} className="rounded-lg px-2 py-1 text-xs font-mono text-muted-foreground hover:text-foreground transition-colors">
          {lang.toUpperCase()}
        </button>
        <button onClick={toggleTheme} className="rounded-lg px-2 py-1 text-sm hover:bg-muted transition-colors">
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
      </div>

      {/* Logo */}
      <div className="mb-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground text-3xl font-black">
          M
        </div>
        <h1 className="text-4xl font-black tracking-tight text-foreground">maika.ge</h1>
        <p className="mt-2 text-muted-foreground">{lang === "en" ? "Choose your experience" : "აირჩიეთ რეჟიმი"}</p>
      </div>

      {/* Mode Cards */}
      <div className="grid w-full max-w-2xl gap-6 sm:grid-cols-2">
        {/* Simple Mode */}
        <button
          onClick={() => setMode("simple")}
          className="group relative flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-8 text-left transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary text-foreground">
            <Image className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-card-foreground">maika.ge</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {lang === "en"
                ? "Upload your photo or add text — place it on any product. Quick and simple, no account needed."
                : "ატვირთეთ ფოტო ან დაამატეთ ტექსტი — მოათავსეთ ნებისმიერ პროდუქტზე. სწრაფი და მარტივი, ანგარიში არ არის საჭირო."}
            </p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
              <Image className="h-3 w-3" /> {lang === "en" ? "Photo Upload" : "ფოტოს ატვირთვა"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
              <Type className="h-3 w-3" /> {lang === "en" ? "Add Text" : "ტექსტის დამატება"}
            </span>
          </div>
        </button>

        {/* Studio Mode */}
        <button
          onClick={() => setMode("studio")}
          className="group relative flex flex-col items-start gap-4 rounded-2xl border border-border bg-card p-8 text-left transition-all hover:border-primary hover:shadow-lg hover:shadow-primary/10"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-card-foreground">Studio.maika.ge</h2>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {lang === "en"
                ? "AI-powered design studio. Generate unique artwork, save designs, and explore the community."
                : "AI დიზაინ სტუდია. შექმენით უნიკალური ნამუშევრები, შეინახეთ დიზაინები და გამოიკვლიეთ საზოგადოება."}
            </p>
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <Sparkles className="h-3 w-3" /> {lang === "en" ? "AI Generation" : "AI გენერაცია"}
            </span>
          </div>
        </button>
      </div>
    </div>
  );
}
