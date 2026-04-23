import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

export type AppMode = "landing" | "simple" | "studio" | "terms" | "privacy" | "corporate" | "sport" | "about";

export type AppTheme = "dark" | "green";

interface AppStateContextType {
  lang: Lang;
  toggleLang: () => void;
  theme: AppTheme;
  toggleTheme: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

// Sub-pages that should be reachable via browser back (return to landing)
const SUBPAGES: AppMode[] = ["about", "terms", "privacy", "corporate", "sport"];

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem("maika-lang") as Lang) || "ge";
  });

  const [theme, setTheme] = useState<AppTheme>(() => {
    return (localStorage.getItem("maika-theme") as AppTheme) || "dark";
  });

  // Restore mode from sessionStorage (cleared on tab close → fresh visit always starts at landing)
  // sessionStorage is preserved during OAuth redirects within the same tab/session
  const [mode, setModeState] = useState<AppMode>(() => {
    const saved = sessionStorage.getItem("maika-mode") as AppMode;
    return (saved === "simple" || saved === "studio") ? saved : "landing";
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "green");
    root.classList.add(theme);
    localStorage.setItem("maika-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("maika-lang", lang);
  }, [lang]);

  useEffect(() => {
    sessionStorage.setItem("maika-mode", mode);
  }, [mode]);

  const toggleLang = useCallback(() => setLang((l) => (l === "en" ? "ge" : "en")), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "green" : "dark")), []);

  const setMode = useCallback((m: AppMode) => {
    setModeState((prev) => {
      if (m !== prev && SUBPAGES.includes(m) && !SUBPAGES.includes(prev)) {
        window.history.pushState({ maikaMode: prev }, "", window.location.pathname + window.location.search);
      }
      return m;
    });
  }, []);

  useEffect(() => {
    const handlePop = (e: PopStateEvent) => {
      const st = e.state as { maikaMode?: AppMode } | null;
      if (st?.maikaMode) {
        setModeState(st.maikaMode);
        return;
      }
      setModeState((prev) => (SUBPAGES.includes(prev) ? "landing" : prev));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  return (
    <AppStateContext.Provider value={{ lang, toggleLang, theme, toggleTheme, mode, setMode }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
