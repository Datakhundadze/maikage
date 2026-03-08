import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { AppStateProvider, useAppState } from "@/hooks/useAppState";
import LoginPage from "./pages/LoginPage";
import StudioPage from "./pages/StudioPage";
import MyDesignsPage from "./pages/MyDesignsPage";
import CommunityPage from "./pages/CommunityPage";
import AdminPage from "./pages/AdminPage";
import LandingPage from "./pages/LandingPage";
import SimplePage from "./pages/SimplePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading } = useAuth();
  const { mode } = useAppState();

  if (mode === "landing") {
    return <LandingPage />;
  }

  if (mode === "simple") {
    return <SimplePage />;
  }

  // Studio mode — requires auth
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route path="/" element={<StudioPage />} />
      <Route path="/my-designs" element={<MyDesignsPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AppStateProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </AppStateProvider>
  </QueryClientProvider>
);

export default App;
