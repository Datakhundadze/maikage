import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { LogOut, LogIn, Paintbrush, FolderOpen, Globe, ShieldCheck } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import LoginModal from "@/components/LoginModal";

export default function AppHeader() {
  const { user, isAnonymous, signOut, displayName } = useAuth();
  const { lang, toggleLang, theme, toggleTheme, setMode } = useAppState();
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

  return (
    <>
      <header className="h-14 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0">
        {/* LEFT: logo + badge */}
        <button onClick={() => setMode("landing")} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-foreground text-background text-sm font-black dark:bg-primary dark:text-primary-foreground">
            M
          </div>
          <div className="text-left">
            <div className="text-sm font-bold leading-tight">{t(lang, "header.title")}</div>
            <div className="text-[10px] text-muted-foreground leading-none">
              {isLoggedIn ? (user?.email || displayName) : t(lang, "header.guestMode")}
            </div>
          </div>
        </button>

        {/* CENTER: nav tabs (hidden on small, flex on md+) */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1 justify-center">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background dark:bg-primary dark:text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </nav>

        {/* RIGHT: controls */}
        <div className="flex items-center gap-0.5 shrink-0 ml-auto md:ml-0">
          <Button variant="ghost" size="sm" onClick={toggleLang} className="text-[11px] font-mono px-2 h-7">
            {lang.toUpperCase()}
          </Button>
          {/* Two-dot theme switcher */}
          <div className="flex items-center gap-1 px-1">
            <button
              onClick={() => theme !== "dark" && toggleTheme()}
              className={`h-4 w-4 rounded-full bg-[#F97316] transition-all ${theme === "dark" ? "ring-2 ring-[#F97316]/50 scale-110" : "opacity-40"}`}
              title="Dark Orange"
            />
            <button
              onClick={() => theme !== "green" && toggleTheme()}
              className={`h-4 w-4 rounded-full bg-[#25B988] transition-all ${theme === "green" ? "ring-2 ring-[#25B988]/50 scale-110" : "opacity-40"}`}
              title="Light Green"
            />
          </div>
          {isLoggedIn ? (
            <Button variant="ghost" size="sm" onClick={() => signOut(setMode)} className="text-[11px] gap-1 px-2 h-7 text-destructive hover:text-destructive">
              <LogOut className="h-3 w-3" />
            </Button>
          ) : (
            <Button variant="default" size="sm" onClick={() => setShowLogin(true)} className="text-[11px] gap-1 px-2 h-7">
              <LogIn className="h-3 w-3" />
              შესვლა
            </Button>
          )}
        </div>
      </header>

      {/* Mobile nav row */}
      <div className="flex md:hidden items-center gap-0.5 px-2 py-1.5 border-b border-sidebar-border overflow-x-auto">
        {navItems.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                active
                  ? "bg-foreground text-background dark:bg-primary dark:text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          );
        })}
      </div>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
