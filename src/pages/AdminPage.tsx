import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, LayoutDashboard, ShoppingCart, Image, Users, BarChart3, Lock, Building2, Package, LogOut } from "lucide-react";
// Each admin tab is large (full-page CRUD UIs with their own forms,
// tables, and supabase fetchers). Lazy-load them so visiting /admin
// only ships the active tab's bundle — switching tabs fetches the
// rest on demand. The Dashboard is also lazy: even though it's the
// default tab, the chunking lets later tabs avoid landing in the
// same bundle.
const AdminDashboard = lazy(() => import("@/components/admin/AdminDashboard"));
const AdminOrders = lazy(() => import("@/components/admin/AdminOrders"));
const AdminDesigns = lazy(() => import("@/components/admin/AdminDesigns"));
const AdminUsers = lazy(() => import("@/components/admin/AdminUsers"));
const AdminAnalytics = lazy(() => import("@/components/admin/AdminAnalytics"));
const AdminCorporate = lazy(() => import("@/components/admin/AdminCorporate"));
const AdminCatalog = lazy(() => import("@/components/admin/AdminCatalog"));
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAdminTabBadges, type BadgeTabId } from "@/hooks/useAdminTabBadges";
import { supabase } from "@/integrations/supabase/client";
import SeoHead from "@/components/SeoHead";

type Tab = "dashboard" | "orders" | "designs" | "users" | "analytics" | "corporate" | "catalog";
type Mode = "login" | "signup" | "forgot";

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
  const [mode, setMode] = useState<Mode>("login");
  const [resetSent, setResetSent] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(() => readTabFromUrl());
  const { counts: badgeCounts, markSeen: markTabSeen } = useAdminTabBadges();

  // The 5 tabs with badges. Other tabs (dashboard, analytics) are
  // aggregate views with no "new items" semantic and stay unchanged.
  const BADGE_TABS = new Set<Tab>(["orders", "users", "designs", "catalog", "corporate"]);
  const isBadgeTab = (t: Tab): t is BadgeTabId => BADGE_TABS.has(t);

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
    if (isBadgeTab(tab)) markTabSeen(tab);
  };

  // Detect Supabase password recovery flow: when the admin clicks the reset
  // link in their email, Supabase fires PASSWORD_RECOVERY and sets a session.
  // We override the normal "logged-in → dashboard" flow to force a new
  // password before letting them in.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => subscription.unsubscribe();
  }, []);

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
      if (mode === "signup") await signUpWithEmail(email, password);
      else if (mode === "login") await signInWithEmail(email, password);
      else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/admin`,
        });
        if (!error) setResetSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setRecoveryError(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setRecoveryError(error.message);
      } else {
        setRecoveryMode(false);
        setPassword("");
        // Clean the recovery hash from URL so a refresh doesn't re-enter recovery.
        window.history.replaceState(null, "", window.location.pathname);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <SeoHead title="Admin | Maika.ge" noindex />
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Recovery mode supersedes everything: even if Supabase already established a
  // session via the reset link, we require the admin to set a new password
  // before reaching the dashboard.
  if (recoveryMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <SeoHead title="Admin | Maika.ge" noindex />
        <form onSubmit={handleSetNewPassword} className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-black text-xl font-black">
              M
            </div>
            <h1 className="text-xl font-bold text-foreground">ახალი password</h1>
            <p className="text-sm text-muted-foreground">შეიყვანეთ ახალი password ადმინ ანგარიშისთვის</p>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="password"
              placeholder="ახალი password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
              className="pl-10"
            />
          </div>
          {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "..." : "შეცვლა"}
          </Button>
        </form>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <SeoHead title="Admin | Maika.ge" noindex />
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-black text-xl font-black">
              M
            </div>
            <h1 className="text-xl font-bold text-foreground">ადმინ პანელი</h1>
            <p className="text-sm text-muted-foreground">
              {mode === "signup" && "ადმინის რეგისტრაცია"}
              {mode === "login" && "გაიარეთ ავტორიზაცია"}
              {mode === "forgot" && "Password-ის აღდგენა"}
            </p>
          </div>

          {mode === "forgot" && resetSent ? (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm text-foreground space-y-2">
              <p>📧 Reset link გავიგზავნე <strong>{email}</strong>-ზე.</p>
              <p className="text-muted-foreground text-xs">შეამოწმე inbox (და spam folder). ბმულზე დაჭერით დაუბრუნდები აქ ახალი password-ის დასაყენებლად.</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Input
                  type="email"
                  placeholder="ელფოსტა"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
                {mode !== "forgot" && (
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
                )}
                {authError && <p className="text-xs text-destructive">{authError}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "..." : mode === "signup" ? "რეგისტრაცია" : mode === "forgot" ? "Reset link გაგზავნა" : "შესვლა"}
              </Button>
            </>
          )}

          <div className="flex flex-col gap-1.5 text-center text-sm">
            {mode === "login" && (
              <>
                <button
                  type="button"
                  onClick={() => { setMode("forgot"); setResetSent(false); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  ვერ გახსოვს password?
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  არ გაქვთ ანგარიში? რეგისტრაცია
                </button>
              </>
            )}
            {mode === "signup" && (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                უკვე გაქვთ ანგარიში? შესვლა
              </button>
            )}
            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => { setMode("login"); setResetSent(false); }}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                ← უკან, შესვლაზე
              </button>
            )}
          </div>

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
        <SeoHead title="Admin | Maika.ge" noindex />
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
      <SeoHead title="Admin | Maika.ge" noindex />
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
              const badgeCount = isBadgeTab(tab.id) ? badgeCounts[tab.id] : 0;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabClick(tab.id)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-amber-500 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                  {badgeCount > 0 && (
                    <span
                      aria-label={`${badgeCount} new`}
                      className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center"
                    >
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        <Suspense
          fallback={
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          {activeTab === "dashboard" && <AdminDashboard />}
          {activeTab === "orders" && <AdminOrders />}
          {activeTab === "designs" && <AdminDesigns />}
          {activeTab === "users" && <AdminUsers />}
          {activeTab === "catalog" && <AdminCatalog />}
          {activeTab === "analytics" && <AdminAnalytics />}
          {activeTab === "corporate" && <AdminCorporate />}
        </Suspense>
      </div>
    </div>
  );
}
