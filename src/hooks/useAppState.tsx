import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

export type AppMode = "landing" | "simple" | "studio" | "terms" | "privacy" | "corporate";

interface AppStateContextType {
  lang: Lang;
  toggleLang: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    return (localStorage.getItem("maika-lang") as Lang) || "en";
  });

  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("maika-theme") as "light" | "dark") || "dark";
  });

  // Restore mode from sessionStorage (cleared on tab close → fresh visit always starts at landing)
  // sessionStorage is preserved during OAuth redirects within the same tab/session
  const [mode, setModeState] = useState<AppMode>(() => {
    const saved = sessionStorage.getItem("maika-mode") as AppMode;
    return (saved === "simple" || saved === "studio") ? saved : "landing";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("maika-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("maika-lang", lang);
  }, [lang]);

  useEffect(() => {
    sessionStorage.setItem("maika-mode", mode);
  }, [mode]);

  const toggleLang = useCallback(() => setLang((l) => (l === "en" ? "ge" : "en")), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  const setMode = useCallback((m: AppMode) => setModeState(m), []);

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
