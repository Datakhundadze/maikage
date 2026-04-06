import { useAppState } from "@/hooks/useAppState";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { t } from "@/lib/i18n";
import { Paintbrush, FolderOpen, Globe, ShieldCheck } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export default function AppHeader() {
  const { lang, setMode } = useAppState();
  const { isAdmin } = useAdminCheck();
  const navigate = useNavigate();
  const location = useLocation();

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
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-black">
            M
          </div>
          <div className="text-left">
            <div className="text-sm font-bold leading-tight text-sidebar-foreground">{t(lang, "header.title")}</div>
            <div className="text-[10px] text-sidebar-foreground/50 leading-none">
              {t(lang, "header.guestMode")}
            </div>
          </div>
        </button>

        {/* CENTER: nav tabs */}
        <nav className="flex items-center gap-0.5 flex-1 justify-center">
          {navItems.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Mobile nav row - hidden since nav is now always visible */}
    </>
  );
}
