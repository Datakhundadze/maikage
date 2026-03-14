import { useAppState } from "@/hooks/useAppState";
import { Upload, Sparkles, Mail, Phone, ArrowRight, Shield, Zap, Users, BadgeDollarSign } from "lucide-react";

export default function LandingPage() {
  const { setMode, theme, toggleTheme } = useAppState();

  return (
    <div className="relative min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.03]" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
        backgroundSize: '40px 40px'
      }} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-amber-500/5 blur-[120px]" />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        className="fixed top-5 right-5 z-50 rounded-full p-2 text-gray-400 dark:text-white/40 hover:text-gray-800 dark:hover:text-white/80 transition-colors"
      >
        {theme === "dark" ? "☀️" : "🌙"}
      </button>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center min-h-screen px-4 py-12 sm:py-20">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-16 sm:mb-20">
          <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center text-black text-xl font-black">
            M
          </div>
          <span className="text-xl font-bold tracking-tight text-gray-900/90 dark:text-white/90">maika.ge</span>
        </div>

        {/* Hero */}
        <div className="text-center mb-16 sm:mb-20 max-w-3xl">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-[1.2] mb-3 text-gray-900 dark:text-white">
            შექმენი შენი სტილი{" "}
            <span className="bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 bg-clip-text text-transparent">
              მარტივად
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-500 dark:text-white/50 font-light tracking-wide">
            Create your unique design easily
          </p>
        </div>

        {/* Mode Cards */}
        <div className="grid w-full max-w-4xl gap-6 sm:grid-cols-2 mb-16 sm:mb-20">
          {/* Simple Mode */}
          <button
            onClick={() => setMode("simple")}
            className="group relative flex flex-col rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] backdrop-blur-sm p-8 sm:p-10 text-left transition-all duration-300 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-100 dark:hover:bg-white/[0.06] hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/5 dark:hover:shadow-white/5"
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 mb-6 transition-colors group-hover:bg-amber-500/20">
              <Upload className="h-6 w-6 text-amber-500" />
            </div>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white">მარტივი რეჟიმი</h2>
            </div>
            <p className="text-sm text-gray-500 dark:text-white/40 leading-relaxed mb-6 flex-1">
              ატვირთე ფოტო ან დაწერე ტექსტი. რეგისტრაცია საჭირო არ არის.
            </p>
            <div className="flex items-center justify-between w-full">
              <span className="inline-flex items-center rounded-full bg-gray-200 dark:bg-white/10 px-3 py-1 text-xs font-medium text-gray-600 dark:text-white/60">
                უფასო • სწრაფი
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-white/70 group-hover:text-gray-900 dark:group-hover:text-white transition-colors">
                დაწყება <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </div>
          </button>

          {/* Studio Mode */}
          <button
            onClick={() => setMode("studio")}
            className="group relative flex flex-col rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] backdrop-blur-sm p-8 sm:p-10 text-left transition-all duration-300 hover:border-amber-500/40 hover:bg-amber-500/[0.08] hover:scale-[1.02] hover:shadow-2xl hover:shadow-amber-500/10"
          >
            {/* Glow */}
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            
            <div className="relative z-10 flex flex-col h-full">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/15 mb-6 transition-colors group-hover:bg-amber-500/25">
                <Sparkles className="h-6 w-6 text-amber-500" />
              </div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-2xl font-bold text-white">AI სტუდიო</h2>
              </div>
              <p className="text-sm text-white/40 leading-relaxed mb-6 flex-1">
                შექმენი პროფესიონალური დიზაინი ხელოვნური ინტელექტის დახმარებით
              </p>
              <div className="flex items-center justify-between w-full">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-400">
                  AI Powered ✨
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-400/70 group-hover:text-amber-400 transition-colors">
                  სტუდიოში შესვლა <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </div>
          </button>
        </div>

        {/* Corporate Section */}
        <div className="w-full max-w-4xl mb-20 sm:mb-28">
          <div className="relative rounded-3xl border border-white/[0.08] bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 dark:from-white/[0.03] dark:via-white/[0.02] dark:to-white/[0.01] p-8 sm:p-12 overflow-hidden">
            {/* Subtle glow */}
            <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-amber-500/[0.06] blur-[100px] pointer-events-none" />
            
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-1 w-8 rounded-full bg-amber-500" />
                <span className="text-xs font-semibold text-amber-500 uppercase tracking-wider">B2B</span>
              </div>
              
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
                კორპორატიული განყოფილება
              </h2>
              <p className="text-sm sm:text-base text-white/50 leading-relaxed max-w-2xl mb-8">
                გთავაზობთ კორპორატიულ მომსახურებას — ბრენდირებული ტანსაცმელი, აქსესუარები და სარეკლამო პროდუქცია თქვენი კომპანიისთვის. ინდივიდუალური მიდგომა ყველა პროექტისთვის.
              </p>

              {/* Feature Icons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
                {[
                  { icon: Shield, label: "ხარისხი" },
                  { icon: Zap, label: "სისწრაფე" },
                  { icon: Users, label: "ინდივიდუალური მიდგომა" },
                  { icon: BadgeDollarSign, label: "კონკურენტული ფასები" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex flex-col items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
                      <Icon className="h-5 w-5 text-amber-500" />
                    </div>
                    <span className="text-xs font-medium text-white/70">{label}</span>
                  </div>
                ))}
              </div>

              <a
                href="mailto:maika@maika.ge"
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold px-6 py-3 text-sm transition-colors"
              >
                დაგვიკავშირდი <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer / Contact */}
        <div className="mt-auto flex flex-col items-center gap-4 text-white text-sm">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            <a href="mailto:maika@maika.ge" className="inline-flex items-center gap-2 text-white hover:text-white/80 transition-colors">
              <Mail className="h-4 w-4" /> maika@maika.ge
            </a>
            <a href="tel:+995322050620" className="inline-flex items-center gap-2 text-white hover:text-white/80 transition-colors">
              <Phone className="h-4 w-4" /> +(995 32) 2-05-06-20
            </a>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <button onClick={() => setMode("terms")} className="text-white hover:text-white/80 transition-colors text-xs">
              წესები და პირობები
            </button>
            <span className="text-white/30">•</span>
            <button onClick={() => setMode("privacy")} className="text-white hover:text-white/80 transition-colors text-xs">
              კონფიდენციალურობა
            </button>
          </div>
          <div className="flex items-center gap-4">
            {/* WhatsApp */}
            <a href="https://wa.me/995599050807" target="_blank" rel="noopener noreferrer" className="text-white hover:text-white/80 transition-colors" aria-label="WhatsApp">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            </a>
            {/* Facebook */}
            <a href="https://facebook.com/maika.ge" target="_blank" rel="noopener noreferrer" className="text-white hover:text-white/80 transition-colors" aria-label="Facebook">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
            </a>
            {/* TikTok */}
            <a href="https://www.tiktok.com/@maika.ge" target="_blank" rel="noopener noreferrer" className="text-white hover:text-white/80 transition-colors" aria-label="TikTok">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
            </a>
            {/* Instagram */}
            <a href="https://www.instagram.com/direct/t/105898054141581/" target="_blank" rel="noopener noreferrer" className="text-white hover:text-white/80 transition-colors" aria-label="Instagram">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
            </a>
          </div>
          <div className="flex items-center gap-2 text-white/60 text-xs">
            <a href="https://wa.me/995599050807" target="_blank" rel="noopener noreferrer" className="hover:text-white/80 transition-colors">
              599 05 08 07
            </a>
          </div>
          <p className="text-xs text-white/60 mt-2">© 2026 maika.ge</p>
        </div>
      </div>
    </div>
  );
}
