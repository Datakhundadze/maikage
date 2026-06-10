import { useState, lazy, Suspense } from "react";
import { useAppState } from "@/hooks/useAppState";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { t } from "@/lib/i18n";
import { Paintbrush, FolderOpen, ShieldCheck, LogIn, LogOut, ShoppingCart, Images } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
// LoginModal only opens when the user clicks "Sign in" — keep its
// bundle separate so the header on logged-in pages stays cheap.
const LoginModal = lazy(() => import("@/components/LoginModal"));
import { useCart } from "@/hooks/useCart";

// Hover-preload map: when the customer hovers a nav button we kick off
// the route's chunk fetch so the click-to-render gap shrinks from
// "wait for the chunk to download" to ~0 ms. Vite's module cache
// dedupes repeat calls, so hovering twice is free. The studio route
// "/" lives in the main bundle, so no entry here.
const PRELOAD_BY_PATH: Record<string, () => Promise<unknown>> = {
  "/designs": () => import("@/pages/CatalogPage"),
  "/my-designs": () => import("@/pages/MyDesignsPage"),
  "/admin": () => import("@/pages/AdminPage"),
};

export default function AppHeader() {
  const { lang, setMode, toggleLang } = useAppState();
  const { itemCount } = useCart();
  const { user, isAnonymous, signOut } = useAuth();
  const { isAdmin } = useAdminCheck();
  const navigate = useNavigate();
  const location = useLocation();
  const [showLogin, setShowLogin] = useState(false);

  const isLoggedIn = !!user && !isAnonymous;

  const navItems = [
    { path: "/", label: t(lang, "nav.studio"), icon: Paintbrush },
    { path: "/designs", label: t(lang, "nav.catalog"), icon: Images },
    { path: "/my-designs", label: t(lang, "nav.myDesigns"), icon: FolderOpen },
    ...(isAdmin ? [{ path: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  // Small badge showing current section
  const pageBadge = location.pathname === "/my-designs"
    ? (lang === "en" ? "My Designs" : "ჩემი დიzaინები")
    : (lang === "en" ? "AI Studio" : "AI სტუდია");

  return (
    <>
      <header className="h-14 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0 bg-sidebar text-sidebar-foreground">
        {/* LEFT: logo — navigates home. setMode("landing") alone is a
            no-op on non-root routes (/designs, /design/:slug, etc.):
            mode flips but the URL stays put, and AppRoutes only renders
            mode views at "/". navigate("/") moves the URL to "/" where
            AppRoutes then honours mode === "landing". */}
        <button
          onClick={() => {
            setMode("landing");
            navigate("/");
          }}
          aria-label={lang === "en" ? "Home" : "მთავარი"}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0 cursor-pointer"
        >
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
            const preload = PRELOAD_BY_PATH[path];
            return (
              <button
                key={path}
                onClick={() => {
                  // Modes "cart"/"simple"/"landing" hijack rendering before
                  // the Routes block in App.tsx, so navigate() alone doesn't
                  // leave them. Reset mode to "studio" (the default Routes
                  // mode) before navigating.
                  setMode("studio");
                  navigate(path);
                }}
                onMouseEnter={preload}
                onFocus={preload}
                onTouchStart={preload}
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

        {/* RIGHT: cart + lang + auth */}
        <div className="shrink-0 flex items-center gap-1.5">
          <button
            onClick={() => {
              // Same fix as the logo (bug #3): setMode alone is a no-op
              // on routes in AppRoutes' ALWAYS_ROUTED list (/designs,
              // /design/:slug, /community, /my-designs, /corporate),
              // because those paths always render through <Routes> and
              // ignore the mode switch. Navigating to "/" first moves
              // the pathname out of that list so the mode='cart' branch
              // in AppRoutes can render <CartPage />.
              setMode("cart");
              navigate("/");
            }}
            className="relative flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors border border-sidebar-border"
            title={lang === "en" ? "Cart" : "კალათა"}
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            {itemCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                {itemCount}
              </span>
            )}
          </button>
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

      <Suspense fallback={null}>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
      </Suspense>
    </>
  );
}
