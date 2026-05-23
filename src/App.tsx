import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Suspense, lazy } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useAutoLogout } from "@/hooks/useAutoLogout";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";
import { CartProvider } from "@/hooks/useCart";
import { RouteChangeTracker } from "@/components/RouteChangeTracker";

// Each route component is a separate JS chunk after Vite build. Customers
// visiting the landing page no longer download the admin / catalog /
// studio code unless they navigate there. Suspense renders a small
// spinner while the next chunk loads (typically < 200 ms on a warm
// cache, ~1 s cold over 4G).
const CartPage = lazy(() => import("./pages/CartPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const StudioPage = lazy(() => import("./pages/StudioPage"));
const MyDesignsPage = lazy(() => import("./pages/MyDesignsPage"));
const CommunityPage = lazy(() => import("./pages/CommunityPage"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));
const DesignDetailPage = lazy(() => import("./pages/DesignDetailPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const SimplePage = lazy(() => import("./pages/SimplePage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const CorporatePage = lazy(() => import("./pages/CorporatePage"));
const SportPage = lazy(() => import("./pages/SportPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const TryOnPage = lazy(() => import("./pages/TryOnPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// LoginPage is currently unused at the routing layer (no <LoginPage />
// renders in this file) but kept as a lazy import so its bundle stays
// separate if a future route references it.
void LoginPage;

const queryClient = new QueryClient();

// Direct-URL paths that must always go through <Routes>, even when
// useAppState's persisted mode would otherwise short-circuit to a full-page
// view (landing, simple, cart, etc.). Without this, a first-time visitor —
// whose mode defaults to "landing" — would see the landing page when they
// open /designs, /my-designs, /community, /design/<slug>, etc. directly.
const ALWAYS_ROUTED: RegExp[] = [
  /^\/designs(\/|$)/,
  /^\/design\//,
  /^\/community(\/|$)/,
  /^\/my-designs(\/|$)/,
  /^\/corporate(\/|$)/,
  /^\/faq(\/|$)/,
];

// Shared fallback for chunk-load suspensions. Mirrors the spinner used by
// AppRoutes' auth-loading state so the visual is consistent.
function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const { mode } = useAppState();
  useAutoLogout();
  const { pathname } = useLocation();

  // Admin route is standalone — bypass mode checks
  if (pathname === "/admin") return <Routes><Route path="/admin" element={<AdminPage />} /></Routes>;

  // Try-on page is standalone — accessible from all modes
  if (pathname === "/try-on") return <Routes><Route path="/try-on" element={<TryOnPage />} /></Routes>;

  const isAlwaysRouted = ALWAYS_ROUTED.some((re) => re.test(pathname));

  if (!isAlwaysRouted) {
    if (mode === "landing") return <LandingPage />;
    if (mode === "simple") return <SimplePage />;
    if (mode === "terms") return <TermsPage />;
    if (mode === "privacy") return <PrivacyPage />;
    if (mode === "corporate") return <CorporatePage />;
    if (mode === "sport") return <SportPage />;
    if (mode === "about") return <AboutPage />;
    if (mode === "cart") return <CartPage />;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
      <Route path="/designs" element={<CatalogPage />} />
      <Route path="/design/:slug" element={<DesignDetailPage />} />
      <Route path="/my-designs" element={<MyDesignsPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/corporate" element={<CorporatePage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <AppStateProvider>
        <AuthProvider>
          <CartProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <RouteChangeTracker />
                <Suspense fallback={<RouteLoadingFallback />}>
                  <AppRoutes />
                </Suspense>
              </BrowserRouter>
            </TooltipProvider>
          </CartProvider>
        </AuthProvider>
      </AppStateProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
