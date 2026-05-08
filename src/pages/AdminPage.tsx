import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, LayoutDashboard, ShoppingCart, Image, Users, BarChart3, Lock, Building2, Package, LogOut } from "lucide-react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminOrders from "@/components/admin/AdminOrders";
import AdminDesigns from "@/components/admin/AdminDesigns";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import AdminCorporate from "@/components/admin/AdminCorporate";
import AdminCatalog from "@/components/admin/AdminCatalog";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";

type Tab = "dashboard" | "orders" | "designs" | "users" | "analytics" | "corporate" | "catalog";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "დეშბორდი", icon: LayoutDashboard },
  { id: "orders", label: "შეკვეთები", icon: ShoppingCart },
  { id: "users", label: "მომხმარებლები", icon: Users },
  { id: "designs", label: "დიზაინები", icon: Image },
  { id: "catalog", label: "📦 კატალოგი", icon: Package },
  { id: "analytics", label: "ანალიტიკა", icon: BarChart3 },
  { id: "corporate", label: "კორპორატიული", icon: Building2 },
];

function readTabFromUrl(): Tab {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("tab");
  if (v === "orders" || v === "designs" || v === "users" || v === "analytics" || v === "corporate" || v === "catalog") return v;
  return "dashboard";
}

function writeTabToUrl(tab: Tab) {
  const params = new URLSearchParams(window.location.search);
  if (tab === "dashboard") {
    params.delete("tab");
    params.delete("subtab");
  } else {
    params.set("tab", tab);
    if (tab !== "catalog") params.delete("subtab");
  }
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? "?" + qs : ""}`;
  window.history.replaceState(null, "", next);
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signInWithEmail, signUpWithEmail, signOut, error: authError } = useAuth();
  const { isAdmin, loading: adminLoading } = useAdminCheck();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => readTabFromUrl());

  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;

  const authenticated = !!user && isAdmin;
  const checking = authLoading || (!!user && adminLoading);

  // Keep ?tab=... in sync with state so admins can deep-link / share URLs.
  useEffect(() => {
    if (authenticated) writeTabToUrl(activeTab);
  }, [authenticated, activeTab]);

  useEffect(() => {
    if (!authenticated) return;
    window.history.pushState(null, "", window.location.href);
    const onPop = () => {
      window.history.pushState(null, "", window.location.href);
      if (tabRef.current !== "dashboard") {
        setActiveTab("dashboard");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [authenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (isSignUp) await signUpWithEmail(email, password);
      else await signInWithEmail(email, password);
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-black text-xl font-black">
              M
            </div>
            <h1 className="text-xl font-bold text-foreground">ადმინ პანელი</h1>
            <p className="text-sm text-muted-foreground">
              {isSignUp ? "ადმინის რეგისტრაცია" : "გაიარეთ ავტორიზაცია"}
            </p>
          </div>
          <div className="space-y-2">
            <Input
              type="email"
              placeholder="ელფოსტა"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="პაროლი"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="pl-10"
              />
            </div>
            {authError && <p className="text-xs text-destructive">{authError}</p>}
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "..." : isSignUp ? "რეგისტრაცია" : "შესვლა"}
          </Button>
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {isSignUp ? "უკვე გაქვთ ანგარიში? შესვლა" : "არ გაქვთ ანგარიში? რეგისტრაცია"}
          </button>
          <Button variant="ghost" type="button" className="w-full text-muted-foreground" onClick={() => navigate("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> მთავარ გვერდზე
          </Button>
        </form>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/20 text-destructive">
            <Lock className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-bold text-foreground">წვდომა აკრძალულია</h1>
          <p className="text-sm text-muted-foreground">
            ეს ანგარიში ({user.email}) არ არის ადმინი.
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" onClick={() => signOut()}>
              <LogOut className="mr-2 h-4 w-4" /> გასვლა
            </Button>
            <Button variant="ghost" onClick={() => navigate("/")}>
              <ArrowLeft className="mr-2 h-4 w-4" /> მთავარ გვერდზე
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center gap-4 h-14">
            {activeTab !== "dashboard" && (
              <Button variant="ghost" size="icon" onClick={() => setActiveTab("dashboard")}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-amber-500 flex items-center justify-center text-black text-sm font-black">
                M
              </div>
              <div>
                <h1 className="text-sm font-bold leading-tight">ადმინ პანელი</h1>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto gap-1" onClick={() => signOut()}>
              <LogOut className="h-4 w-4" /> გასვლა
            </Button>
          </div>

          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-amber-500 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {activeTab === "dashboard" && <AdminDashboard />}
        {activeTab === "orders" && <AdminOrders />}
        {activeTab === "designs" && <AdminDesigns />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "catalog" && <AdminCatalog />}
        {activeTab === "analytics" && <AdminAnalytics />}
        {activeTab === "corporate" && <AdminCorporate />}
      </div>
    </div>
  );
}
