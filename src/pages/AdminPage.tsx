import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, LayoutDashboard, ShoppingCart, Image, Users, BarChart3, Lock, Building2 } from "lucide-react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminOrders from "@/components/admin/AdminOrders";
import AdminDesigns from "@/components/admin/AdminDesigns";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import AdminCorporate from "@/components/admin/AdminCorporate";

const ADMIN_PASSWORD = "maika2026admin";

type Tab = "dashboard" | "orders" | "designs" | "users" | "analytics" | "corporate";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "დეშბორდი", icon: LayoutDashboard },
  { id: "orders", label: "შეკვეთები", icon: ShoppingCart },
  { id: "users", label: "მომხმარებლები", icon: Users },
  { id: "designs", label: "დიზაინები", icon: Image },
  { id: "analytics", label: "ანალიტიკა", icon: BarChart3 },
  { id: "corporate", label: "კორპორატიული", icon: Building2 },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setAuthenticated(true);
      setError(false);
    } else {
      setError(true);
    }
  };

  if (!authenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <form onSubmit={handleLogin} className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500 text-black text-xl font-black">
              M
            </div>
            <h1 className="text-xl font-bold text-foreground">ადმინ პანელი</h1>
            <p className="text-sm text-muted-foreground">შეიყვანეთ პაროლი</p>
          </div>
          <div className="space-y-2">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="პაროლი"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(false); }}
                className={`pl-10 ${error ? "border-destructive" : ""}`}
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-destructive">არასწორი პაროლი</p>}
          </div>
          <Button type="submit" className="w-full">შესვლა</Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate("/")}>
            <ArrowLeft className="mr-2 h-4 w-4" /> მთავარ გვერდზე
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center gap-4 h-14">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-amber-500 flex items-center justify-center text-black text-sm font-black">
                M
              </div>
              <div>
                <h1 className="text-sm font-bold leading-tight">ადმინ პანელი</h1>
                <p className="text-xs text-muted-foreground">maika.ge</p>
              </div>
            </div>
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
        {activeTab === "analytics" && <AdminAnalytics />}
        {activeTab === "corporate" && <AdminCorporate />}
      </div>
    </div>
  );
}
