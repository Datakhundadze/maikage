import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { LogOut, LogIn, Paintbrush, FolderOpen, Globe, Image, ShieldCheck } from "lucide-react";
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
      <header className="flex flex-col gap-3 p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          <button onClick={() => setMode("landing")} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background text-lg font-black dark:bg-primary dark:text-primary-foreground">
              M
            </div>
            <div className="text-left">
              <h1 className="text-xl font-bold leading-tight">{t(lang, "header.title")}</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>{isLoggedIn ? (user?.email || displayName) : t(lang, "header.guestMode")}</span>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${isLoggedIn ? "bg-green-500" : "bg-primary"}`} />
              </div>
            </div>
          </button>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setMode("simple")} className="text-xs gap-1 px-2">
              <Image className="h-3.5 w-3.5" />
              Simple
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleLang} className="text-xs font-mono px-2">
              {lang.toUpperCase()}
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleTheme} className="px-2">
              {theme === "dark" ? "☀️" : "🌙"}
            </Button>

            {isLoggedIn ? (
              <Button variant="ghost" size="sm" onClick={() => signOut(setMode)} className="text-xs gap-1 px-2 text-destructive hover:text-destructive">
                <LogOut className="h-3.5 w-3.5" />
                გასვლა
              </Button>
            ) : (
              <Button variant="default" size="sm" onClick={() => setShowLogin(true)} className="text-xs gap-1 px-3">
                <LogIn className="h-3.5 w-3.5" />
                შესვლა
              </Button>
            )}
          </div>
        </div>

        <nav className="flex gap-1">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  active
                    ? "bg-foreground text-background dark:bg-primary dark:text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </nav>
      </header>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
    </>
  );
}
