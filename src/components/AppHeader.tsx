import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function AppHeader() {
  const { user, displayName, isAnonymous, signOut } = useAuth();
  const { lang, toggleLang, theme, toggleTheme } = useAppState();

  return (
    <header className="flex items-center justify-between p-4 border-b border-sidebar-border">
      {/* Left: Logo + User */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background text-lg font-black dark:bg-banana-500 dark:text-foreground">
          M
        </div>
        <div>
          <h1 className="text-xl font-bold leading-tight">{t(lang, "header.title")}</h1>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{user?.email || t(lang, "header.guestMode")}</span>
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                isAnonymous ? "bg-banana-500" : "bg-green-500"
              }`}
            />
          </div>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={toggleLang} className="text-xs font-mono px-2">
          {lang.toUpperCase()}
        </Button>
        <Button variant="ghost" size="sm" onClick={toggleTheme} className="px-2">
          {theme === "dark" ? "☀️" : "🌙"}
        </Button>
        <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
