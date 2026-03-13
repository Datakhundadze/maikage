import { useState } from "react";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LayoutDashboard, ShoppingCart, Image, Users } from "lucide-react";
import AdminDashboard from "@/components/admin/AdminDashboard";
import AdminOrders from "@/components/admin/AdminOrders";
import AdminDesigns from "@/components/admin/AdminDesigns";
import AdminUsers from "@/components/admin/AdminUsers";

type Tab = "dashboard" | "orders" | "designs" | "users";

const TABS: { id: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "დეშბორდი", icon: LayoutDashboard },
  { id: "orders", label: "შეკვეთები", icon: ShoppingCart },
  { id: "designs", label: "დიზაინები", icon: Image },
  { id: "users", label: "მომხმარებლები", icon: Users },
];

export default function AdminPage() {
  const { isAdmin, loading: adminLoading } = useAdminCheck();
  const { loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  if (adminLoading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
        <h1 className="text-2xl font-bold">წვდომა შეზღუდულია</h1>
        <p className="text-muted-foreground">ადმინისტრატორის უფლებები არ გაქვთ.</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> უკან
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
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

          {/* Tabs */}
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-primary text-foreground"
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

      {/* Content */}
      <div className="mx-auto max-w-7xl p-4 sm:p-6">
        {activeTab === "dashboard" && <AdminDashboard />}
        {activeTab === "orders" && <AdminOrders />}
        {activeTab === "designs" && <AdminDesigns />}
        {activeTab === "users" && <AdminUsers />}
      </div>
    </div>
  );
}
