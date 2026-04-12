import { useState } from "react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { t } from "@/lib/i18n";
import { Paintbrush, FolderOpen, Globe, ShieldCheck, LogIn, LogOut } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import LoginModal from "@/components/LoginModal";

export default function AppHeader() {
  const { lang, setMode, toggleLang } = useAppState();
  const { user, isAnonymous, signOut } = useAuth();
  const { isAdmin } = useAdminCheck();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLogin, setShowLogin] = useState(false);

  const isLoggedIn = !!user && !isAnonymous;

  const navItems = [
    { path: "/", label: t(lang, "nav.studio"), icon: Paintbrush },
    { path: "/my-designs", label: t(lang, "nav.myDesigns"), icon: FolderOpen },
    { path: "/community", label: t(lang, "nav.community"), icon: Globe },
    ...(isAdmin ? [{ path: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  // Small badge showing current section
  const pageBadge = location.pathname === "/my-designs"
    ? (lang === "en" ? "My Designs" : "ჩემი დიzaინები")
    : location.pathname === "/community"
    ? (lang === "en" ? "Samples" : "მაგალითები")
    : (lang === "en" ? "AI Studio" : "AI სტუდია");

  return (
    <>
      <header className="h-14 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0 bg-sidebar text-sidebar-foreground">
        {/* LEFT: logo */}
        <button onClick={() => setMode("landing")} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-black">
            M
          </div>
          <div className="text-left hidden sm:block">
            <div className="text-sm font-bold leading-tight text-sidebar-foreground">{t(lang, "header.title")}</div>
            <div className="text-[10px] text-sidebar-foreground/50 leading-none">
              {isLoggedIn ? (user?.email?.split("@")[0] || "სტუმარი") : (lang === "en" ? "Guest" : "სტუმარი")}
            </div>
          </div>
        </button>

        {/* CENTER: nav tabs */}
        <nav className="flex items-center gap-0.5 flex-1 justify-center overflow-x-auto">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-3 w-3" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* RIGHT: lang + auth */}
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={toggleLang}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors border border-sidebar-border"
            title={lang === "en" ? "Switch to Georgian" : "Switch to English"}
          >
            {lang === "en" ? "🌐 GE" : "🌐 EN"}
          </button>
          {isLoggedIn ? (
            <button
              onClick={() => signOut(setMode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{lang === "en" ? "Sign out" : "გასვლა"}</span>
            </button>
          ) : (
            <button
              onClick={() => setShowLogin(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-sidebar-primary text-sidebar-primary-foreground hover:opacity-90 transition-opacity"
            >
              <LogIn className="h-3.5 w-3.5" />
              {lang === "en" ? "Sign in" : "შესვლა"}
            </button>
          )}
        </div>
      </header>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
