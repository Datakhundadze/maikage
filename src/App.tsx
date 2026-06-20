import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { Suspense, lazy } from "react";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useAutoLogout } from "@/hooks/useAutoLogout";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";
import { CartProvider } from "@/hooks/useCart";
import { RouteChangeTracker } from "@/components/RouteChangeTracker";

// Each route component is a separate JS chunk after Vite build. Customers
// visiting the landing page no longer download the admin / catalog /
// simple-mode code unless they navigate there. Suspense renders a small
// spinner while the next chunk loads (typically < 200 ms on a warm
// cache, ~1 s cold over 4G).
const CartPage = lazy(() => import("./pages/CartPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const MyDesignsPage = lazy(() => import("./pages/MyDesignsPage"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));
const DesignDetailPage = lazy(() => import("./pages/DesignDetailPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const SimplePage = lazy(() => import("./pages/SimplePage"));
const OrderConfirmationPage = lazy(() => import("./pages/OrderConfirmationPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const CorporatePage = lazy(() => import("./pages/CorporatePage"));
const SportPage = lazy(() => import("./pages/SportPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

// LoginPage is currently unused at the routing layer (no <LoginPage />
// renders in this file) but kept as a lazy import so its bundle stays
// separate if a future route references it.
void LoginPage;

const queryClient = new QueryClient();

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
  const { pathname, search } = useLocation();

  // Post-payment redirect: the bank returns the user to /?payment=success&orderId=…
  // (or payment=fail). Mode is persisted in sessionStorage, so after a Simple/
  // Cart checkout the root would otherwise render that mode's page and miss the
  // result. Catch it here — independent of mode — and route to the persistent
  // confirmation view, preserving the query string.
  if (pathname === "/" && new URLSearchParams(search).has("payment")) {
    return <Navigate to={`/order-confirmation${search}`} replace />;
  }

  // Admin route is standalone — bypass mode checks
  if (pathname === "/admin") return <Routes><Route path="/admin" element={<AdminPage />} /></Routes>;

  // Mode views (landing, simple, cart, terms, …) are URL-less surfaces that
  // only ever live at the root — setMode never changes the URL, and every
  // entry point into them happens at "/". Gating them on the root path means
  // every non-root URL goes through <Routes>: known paths match their
  // <Route>, unknown paths fall through to "*" → NotFound (previously an
  // unknown path in landing mode soft-404'd to the landing page).
  if (pathname === "/") {
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
      <Route path="/" element={<SimplePage />} />
      <Route path="/designs" element={<CatalogPage />} />
      <Route path="/design/:slug" element={<DesignDetailPage />} />
      <Route path="/my-designs" element={<MyDesignsPage />} />
      <Route path="/order-confirmation" element={<OrderConfirmationPage />} />
      {/* /community gallery retired — redirect old URL to the catalog so it
          doesn't dead-end (client-side; Lovable has no server redirects). */}
      <Route path="/community" element={<Navigate to="/designs" replace />} />
      <Route path="/corporate" element={<CorporatePage />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/contact" element={<ContactPage />} />
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
