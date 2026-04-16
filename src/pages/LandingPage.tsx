import { useState, useEffect } from "react";
import { useAppState } from "@/hooks/useAppState";
import { Shirt, Sparkles, Mail, Phone, ArrowRight, Shield, Zap, Users, BadgeDollarSign } from "lucide-react";
import CorporateInquiryModal from "@/components/CorporateInquiryModal";

const SPORT_PHOTOS = [
  "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-white-front.png",
  "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-black-front.png",
  "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-white-back.png",
  "https://ykoseamefoabptuijsza.supabase.co/storage/v1/object/public/products/sport/sport-set-black-back.png",
];

export default function LandingPage() {
  const { setMode, theme, toggleTheme, lang, toggleLang } = useAppState();
  const [sportPhotoIdx, setSportPhotoIdx] = useState(0);

  const isGreen = theme === "green";
  // Colors used in green theme
  const GREEN = "#25B988";
  const GREEN_DARK = "#1a8c67";

  useEffect(() => {
    const timer = setInterval(() => {
      setSportPhotoIdx((i) => (i + 1) % SPORT_PHOTOS.length);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[600px] rounded-full bg-white/[0.02] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[200px] bg-amber-500/[0.03] blur-[100px] pointer-events-none" />

      {/* Top bar */}
      <div className="relative z-20 flex items-center justify-between px-4 sm:px-6 py-3">
        {/* Left: theme + lang toggles */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="rounded-full p-2 transition-colors hover:opacity-80"
            title={theme === "dark" ? "Switch to Green" : "Switch to Dark"}
          >
            {theme === "dark"
              ? <span className="h-5 w-5 rounded-full bg-[#25B988] border border-foreground/20 inline-block" />
              : <span className="h-5 w-5 rounded-full bg-black border border-foreground/20 inline-block" />
            }
          </button>
          {/* Language toggle */}
          <button
            onClick={toggleLang}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-colors border ${
              isGreen
                ? "border-white/40 text-white hover:bg-white/10"
                : "border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40"
            }`}
          >
            {lang === "ge" ? "🌐 ENG" : "🌐 GE"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <a href="tel:+995322050620" className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex items-center gap-1">
            <Phone className="h-3 w-3" /> 032 2 05 06 20
          </a>
          <a href="https://wa.me/995599050807" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex items-center gap-1">
            <Phone className="h-3 w-3" /> 599 05 08 07
          </a>
          <a href="mailto:maika@maika.ge" className="text-xs text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex items-center gap-1">
            <Mail className="h-3 w-3" /> maika@maika.ge
          </a>
          <span className="hidden sm:inline text-muted-foreground/30">|</span>
          <div className="flex items-center gap-2">
            <a href="https://wa.me/995599050807" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-green-500 transition-colors" aria-label="WhatsApp">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </a>
            <a href="https://facebook.com/maika.ge" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-blue-500 transition-colors" aria-label="Facebook">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            <a href="https://www.tiktok.com/@maika.ge" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-white transition-colors" aria-label="TikTok">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
            </a>
            <a href="https://www.instagram.com/maika.ge_/" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-pink-500 transition-colors" aria-label="Instagram">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </a>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center min-h-[calc(100vh-52px)] px-4 py-8 sm:py-16">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-16 sm:mb-20">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-black">
            M
          </div>
          <span className="text-xl font-bold tracking-tight" style={{ color: isGreen ? "white" : undefined }}>maika.ge</span>
        </div>

        {/* Hero */}
        <div className="text-center mb-16 sm:mb-20 max-w-3xl">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.2] mb-3 text-foreground">
            {lang === "en" ? "Create your style " : "შექმენი შენი სტილი "}
            <span className="text-primary">
              {lang === "en" ? "easily" : "მარტივად"}
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground font-light tracking-wide">
            {lang === "en" ? "Design your unique products with ease" : "Create your unique design easily"}
          </p>
        </div>

        {/* Mode Cards */}
        <div className="grid w-full max-w-2xl gap-5 sm:grid-cols-2 mb-16 sm:mb-20">

          {/* Card 1 — Simple Mode */}
          <button
            onClick={() => setMode("simple")}
            className={`group relative flex flex-col rounded-2xl border p-8 sm:p-10 text-left transition-all duration-300 hover:scale-[1.02] overflow-hidden ${
              isGreen
                ? "bg-white border-white/80 shadow-lg hover:shadow-xl"
                : "border-white/[0.08] bg-card hover:border-white/[0.15] hover:shadow-xl hover:shadow-black/40"
            }`}
          >
            <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-white/[0.03] to-transparent pointer-events-none" />
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/[0.15] to-transparent pointer-events-none" />
            <div className="relative z-10 flex flex-col h-full">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl mb-6 transition-colors ${isGreen ? "bg-[#25B988]/10 border border-[#25B988]/20" : "bg-[#2a2a2a] border border-white/[0.06] group-hover:bg-[#333]"}`}>
                <Shirt className="h-6 w-6" style={{ color: isGreen ? GREEN : "rgba(255,255,255,0.8)" }} />
              </div>
              <h2 className="text-2xl font-bold mb-3" style={{ color: isGreen ? GREEN : undefined }}>
                {lang === "en" ? "MAIKA.GE Simple Mode" : "MAIKA.GE მარტივი რეჟიმი"}
              </h2>
              <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: isGreen ? GREEN_DARK : undefined }}>
                {lang === "en"
                  ? "Upload a photo or write text. No registration required."
                  : "ატვირთე ფოტო ან დაწერე ტექსტი. რეგისტრაცია საჭირო არ არის."}
              </p>
              <div className="flex items-center justify-between w-full">
                <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${isGreen ? "bg-[#25B988]/10 border border-[#25B988]/20 text-[#25B988]" : "bg-white/[0.06] border border-white/[0.08] text-white/50"}`}>
                  {lang === "en" ? "Free • Fast" : "უფასო • სწრაფი"}
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors" style={{ color: isGreen ? GREEN : "rgba(255,255,255,0.5)" }}>
                  {lang === "en" ? "Start" : "დაწყება"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </div>
          </button>

          {/* Card 2 — AI Studio (FEATURED) */}
          <button
            onClick={() => setMode("studio")}
            className={`group relative flex flex-col rounded-2xl border p-8 sm:p-10 text-left transition-all duration-300 hover:scale-[1.03] overflow-hidden ${
              isGreen
                ? "bg-white border-white/80 shadow-lg hover:shadow-xl"
                : "border-primary/30 bg-card hover:border-primary/50"
            }`}
          >
            {!isGreen && <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/[0.08] via-transparent to-primary/[0.04] pointer-events-none" />}
            {!isGreen && <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent pointer-events-none" />}
            <div className="relative z-10 flex flex-col h-full">
              <div className={`flex h-14 w-14 items-center justify-center rounded-2xl mb-6 transition-colors ${isGreen ? "bg-[#25B988]/10 border border-[#25B988]/20" : "bg-primary/10 border border-primary/20 group-hover:border-primary/40"}`}>
                <Sparkles className="h-6 w-6" style={{ color: isGreen ? GREEN : undefined }} />
              </div>
              <h2 className="text-2xl font-bold mb-3" style={{ color: isGreen ? GREEN : undefined }}>
                {lang === "en" ? "MAIKA.GE AI Studio" : "MAIKA.GE AI სტუდიო"}
              </h2>
              <p className="text-sm leading-relaxed mb-6 flex-1" style={{ color: isGreen ? GREEN_DARK : undefined }}>
                {lang === "en"
                  ? "Create professional designs with the help of artificial intelligence"
                  : "შექმენი პროფესიონალური დიზაინი ხელოვნური ინტელექტის დახმარებით"}
              </p>
              <div className="flex items-center justify-between w-full">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${isGreen ? "bg-[#25B988]/10 border border-[#25B988]/20 text-[#25B988]" : "bg-primary/15 border border-primary/20 text-primary"}`}>
                  AI Powered ✨
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold transition-colors" style={{ color: isGreen ? GREEN : undefined }}>
                  {lang === "en" ? "Enter Studio" : "სტუდიოში შესვლა"} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </div>
          </button>

        </div>

        {/* Corporate Section */}
        <div className="w-full max-w-4xl mb-20 sm:mb-28">
          <div className={`relative rounded-3xl border p-8 sm:p-12 overflow-hidden ${
            isGreen
              ? "bg-white border-white/80 shadow-lg"
              : "border-white/[0.08] bg-gradient-to-br from-[#141414] via-[#111] to-[#0d0d0d]"
          }`}>
            {!isGreen && <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-primary/[0.06] blur-[100px] pointer-events-none" />}

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1 w-8 rounded-full" style={{ backgroundColor: isGreen ? GREEN : undefined, background: !isGreen ? "var(--color-primary)" : undefined }} />
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: isGreen ? GREEN : undefined }}>B2B</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-bold mb-3" style={{ color: isGreen ? GREEN : undefined }}>
                {lang === "en" ? "Corporate Division" : "კორპორატიული განყოფილება"}
              </h2>
              <p className="text-sm sm:text-base leading-relaxed max-w-2xl mb-8" style={{ color: isGreen ? GREEN_DARK : "rgba(255,255,255,0.5)" }}>
                {lang === "en"
                  ? "We offer corporate services — branded clothing, accessories and promotional products for your company. Individual approach for every project."
                  : "გთავაზობთ კორპორატიულ მომსახურებას — ბრენდირებული ტანსაცმელი, აქსესუარები და სარეკლამო პროდუქცია თქვენი კომპანიისთვის. ინდივიდუალური მიდგომა ყველა პროექტისთვის."}
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                {[
                  { icon: Shield, label: lang === "en" ? "Quality" : "ხარისხი" },
                  { icon: Zap, label: lang === "en" ? "Speed" : "სისწრაფე" },
                  { icon: Users, label: lang === "en" ? "Individual Approach" : "ინდივიდუალური მიდგომა" },
                  { icon: BadgeDollarSign, label: lang === "en" ? "Competitive Prices" : "კონკურენტული ფასები" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className={`flex flex-col items-center gap-3 rounded-xl p-4 text-center border ${
                    isGreen ? "bg-[#25B988]/5 border-[#25B988]/20" : "bg-white/[0.04] border-white/[0.06]"
                  }`}>
                    <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${isGreen ? "bg-[#25B988]/10" : "bg-primary/15"}`}>
                      <Icon className="h-8 w-8" style={{ color: isGreen ? GREEN : undefined }} />
                    </div>
                    <span className="text-xs font-medium" style={{ color: isGreen ? GREEN_DARK : "rgba(255,255,255,0.7)" }}>{label}</span>
                  </div>
                ))}
              </div>

              <CorporateInquiryModal>
                <button className={`inline-flex items-center gap-2 rounded-xl font-semibold px-6 py-3 text-sm transition-colors ${
                  isGreen
                    ? "bg-[#25B988] hover:bg-[#1ea876] text-white"
                    : "bg-primary hover:bg-primary/90 text-primary-foreground"
                }`}>
                  {lang === "en" ? "Contact Us" : "დაგვიკავშირდი"} <ArrowRight className="h-4 w-4" />
                </button>
              </CorporateInquiryModal>
            </div>
          </div>
        </div>

        {/* Sports Section */}
        <div className="w-full max-w-4xl mb-12 sm:mb-16">
          <div className={`relative rounded-3xl border p-8 sm:p-12 overflow-hidden ${
            isGreen
              ? "bg-white border-white/80 shadow-lg"
              : "border-white/[0.08] bg-gradient-to-br from-[#141414] via-[#111] to-[#0d0d0d]"
          }`}>
            {!isGreen && <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-primary/[0.06] blur-[100px] pointer-events-none" />}
            <div className="relative z-10 flex flex-col sm:flex-row gap-8 items-center">
              {/* Text content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-1 w-8 rounded-full bg-[#25B988]" />
                  <span className="text-xs font-semibold text-[#25B988] uppercase tracking-wider">SPORT</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold mb-3" style={{ color: isGreen ? GREEN : "white" }}>
                  {lang === "en"
                    ? "Sport Uniforms — Your Team's Identity"
                    : "🏆 სპორტული ფორმები — შენი გუნდის იდენტობა"}
                </h2>
                <p className="text-sm sm:text-base leading-relaxed max-w-2xl mb-8" style={{ color: isGreen ? GREEN_DARK : "rgba(255,255,255,0.7)" }}>
                  {lang === "en"
                    ? "Professional sport uniforms with custom branding — club logo, number, name. Starting from 1 piece."
                    : "პროფესიონალური სპორტული ფორმები ინდივიდუალური ბრენდინგით — კლუბის ლოგო, ნომერი, სახელი. 1 ცალიდან."}
                </p>
                <button
                  onClick={() => setMode("sport")}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#25B988] hover:bg-[#1ea876] text-white font-semibold px-6 py-3 text-sm transition-colors"
                >
                  {lang === "en" ? "Details" : "დეტალები"} <ArrowRight className="h-4 w-4" />
                </button>
              </div>

              {/* Auto-rotating photo slideshow */}
              <div className="relative w-48 h-56 sm:w-56 sm:h-64 flex-shrink-0">
                {SPORT_PHOTOS.map((src, i) => (
                  <img
                    key={src}
                    src={src}
                    alt="Sport Set"
                    className="absolute inset-0 w-full h-full object-contain rounded-2xl transition-opacity duration-700"
                    style={{ opacity: i === sportPhotoIdx ? 1 : 0 }}
                  />
                ))}
                {/* Dot indicators */}
                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {SPORT_PHOTOS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSportPhotoIdx(i)}
                      className={`w-1.5 h-1.5 rounded-full transition-all ${i === sportPhotoIdx ? "bg-[#25B988] w-3" : "bg-white/30"}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto flex flex-col items-center gap-3 text-sm">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <button onClick={() => setMode("about")} className="text-muted-foreground hover:text-foreground transition-colors text-xs">
              {lang === "en" ? "About Us" : "ჩვენი შესახებ"}
            </button>
            <span className="text-muted-foreground/30">•</span>
            <button onClick={() => setMode("terms")} className="text-muted-foreground hover:text-foreground transition-colors text-xs">
              {lang === "en" ? "Terms & Conditions" : "წესები და პირობები"}
            </button>
            <span className="text-muted-foreground/30">•</span>
            <button onClick={() => setMode("privacy")} className="text-muted-foreground hover:text-foreground transition-colors text-xs">
              {lang === "en" ? "Privacy Policy" : "კონფიდენციალურობა"}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">© 2026 maika.ge</p>
        </div>
      </div>
    </div>
  );
}
