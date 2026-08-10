import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";

export type AppMode = "landing" | "simple" | "terms" | "privacy" | "corporate" | "sport" | "about" | "cart";

export type AppTheme = "dark" | "green";

interface AppStateContextType {
  lang: Lang;
  toggleLang: () => void;
  theme: AppTheme;
  toggleTheme: () => void;
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  /** Go back one step in mode history. Returns true if a previous mode existed. */
  goBack: () => boolean;
}

const AppStateContext = createContext<AppStateContextType | null>(null);

const MODE_STACK_KEY = "maika-mode-stack";

export function AppStateProvider({ children }: { children: ReactNode }) {
  // localStorage access is wrapped throughout: inside the Facebook / Instagram
  // in-app browsers it can THROW rather than simply return null, which would
  // otherwise surface as a render error. Falling back to the same defaults
  // degrades the preference silently instead. Defaults are unchanged.
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem("maika-lang") as Lang) || "ge";
    } catch {
      return "ge";
    }
  });

  const [theme, setTheme] = useState<AppTheme>(() => {
    try {
      return (localStorage.getItem("maika-theme") as AppTheme) || "dark";
    } catch {
      return "dark";
    }
  });

  const [mode, setModeState] = useState<AppMode>(() => {
    // The constructor has no URL of its own — it is a mode view at "/" gated on
    // this state, and `maika-mode` lives in sessionStorage, which a NEW TAB does
    // not inherit. So the "ესკიზის ნახვა" handoff opens "/?constructor=1" and we
    // honour that param here; without it the new tab would land on the landing
    // page and the seed would never be applied. (App.tsx only intercepts
    // "?payment" at "/", so this param passes through to the mode gate.)
    try {
      if (new URLSearchParams(window.location.search).get("constructor") === "1") return "simple";
    } catch { /* ignore — fall through to the stored mode */ }
    const saved = sessionStorage.getItem("maika-mode") as AppMode;
    return saved === "simple" ? saved : "landing";
  });

  // Stack of modes visited before the current one. Pop on browser-back.
  const modeStackRef = useRef<AppMode[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MODE_STACK_KEY);
      if (raw) modeStackRef.current = JSON.parse(raw);
    } catch { /* ignore */ }
  }, []);

  const persistStack = useCallback(() => {
    try {
      sessionStorage.setItem(MODE_STACK_KEY, JSON.stringify(modeStackRef.current));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark", "green");
    root.classList.add(theme);
    try { localStorage.setItem("maika-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem("maika-lang", lang); } catch { /* ignore */ }
  }, [lang]);

  useEffect(() => {
    sessionStorage.setItem("maika-mode", mode);
  }, [mode]);

  const toggleLang = useCallback(() => setLang((l) => (l === "en" ? "ge" : "en")), []);
  const toggleTheme = useCallback(() => setTheme((t) => (t === "dark" ? "green" : "dark")), []);

  const setMode = useCallback((m: AppMode) => {
    setModeState((current) => {
      if (current !== m) {
        modeStackRef.current = [...modeStackRef.current, current];
        persistStack();
        window.history.pushState({ mode: m }, "", window.location.href);
      }
      return m;
    });
  }, [persistStack]);

  const goBack = useCallback(() => {
    const stack = modeStackRef.current;
    if (stack.length === 0) return false;
    const prev = stack[stack.length - 1];
    modeStackRef.current = stack.slice(0, -1);
    persistStack();
    setModeState(prev);
    return true;
  }, [persistStack]);

  // Single global popstate handler. Pages no longer need their own.
  useEffect(() => {
    const onPop = () => {
      const didGoBack = goBack();
      if (!didGoBack) {
        window.history.pushState({ mode: "landing" }, "", window.location.href);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goBack]);

  return (
    <AppStateContext.Provider value={{ lang, toggleLang, theme, toggleTheme, mode, setMode, goBack }}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
