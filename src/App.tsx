import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useAutoLogout } from "@/hooks/useAutoLogout";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";
import { CartProvider } from "@/hooks/useCart";
import CartPage from "./pages/CartPage";
import LoginPage from "./pages/LoginPage";
import StudioPage from "./pages/StudioPage";
import MyDesignsPage from "./pages/MyDesignsPage";
import CommunityPage from "./pages/CommunityPage";
import CatalogPage from "./pages/CatalogPage";
import DesignDetailPage from "./pages/DesignDetailPage";
import AdminPage from "./pages/AdminPage";
import LandingPage from "./pages/LandingPage";
import SimplePage from "./pages/SimplePage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import CorporatePage from "./pages/CorporatePage";
import SportPage from "./pages/SportPage";
import AboutPage from "./pages/AboutPage";
import TryOnPage from "./pages/TryOnPage";
import NotFound from "./pages/NotFound";
import { RouteChangeTracker } from "@/components/RouteChangeTracker";

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
];

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
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppStateProvider>
      <AuthProvider>
        <CartProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <RouteChangeTracker />
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </CartProvider>
      </AuthProvider>
    </AppStateProvider>
  </QueryClientProvider>
);

export default App;
