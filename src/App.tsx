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

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading } = useAuth();
  const { mode } = useAppState();
  useAutoLogout();
  const { pathname } = useLocation();

  // Admin route is standalone — bypass mode checks
  if (pathname === "/admin") return <Routes><Route path="/admin" element={<AdminPage />} /></Routes>;

  // Try-on page is standalone — accessible from all modes
  if (pathname === "/try-on") return <Routes><Route path="/try-on" element={<TryOnPage />} /></Routes>;

  if (mode === "landing") return <LandingPage />;
  if (mode === "simple") return <SimplePage />;
  if (mode === "terms") return <TermsPage />;
  if (mode === "privacy") return <PrivacyPage />;
  if (mode === "corporate") return <CorporatePage />;
  if (mode === "sport") return <SportPage />;
  if (mode === "about") return <AboutPage />;
  if (mode === "cart") return <CartPage />;

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
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </CartProvider>
      </AuthProvider>
    </AppStateProvider>
  </QueryClientProvider>
);

export default App;
