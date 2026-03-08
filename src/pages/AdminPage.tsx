import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart3, Layers, Eye, Users } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

interface DailyStat {
  date: string;
  count: number;
}

interface ProductStat {
  product: string;
  count: number;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--secondary))",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
];

export default function AdminPage() {
  const { isAdmin, loading: adminLoading } = useAdminCheck();
  const { loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [totalDesigns, setTotalDesigns] = useState(0);
  const [totalVisits, setTotalVisits] = useState(0);
  const [totalUsers, setTotalUsers] = useState(0);
  const [dailyDesigns, setDailyDesigns] = useState<DailyStat[]>([]);
  const [dailyVisits, setDailyVisits] = useState<DailyStat[]>([]);
  const [productStats, setProductStats] = useState<ProductStat[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (adminLoading || authLoading) return;
    if (!isAdmin) return;

    async function fetchAnalytics() {
      setDataLoading(true);

      // Fetch all events
      const { data: events } = await supabase
        .from("analytics_events")
        .select("event_type, event_data, created_at, user_id")
        .order("created_at", { ascending: true });

      if (!events) {
        setDataLoading(false);
        return;
      }

      // Total counts
      const designs = events.filter((e) => e.event_type === "design_generated");
      const visits = events.filter((e) => e.event_type === "page_visit");
      const products = events.filter((e) => e.event_type === "product_selected");

      setTotalDesigns(designs.length);
      setTotalVisits(visits.length);

      // Unique users
      const uniqueUsers = new Set(events.map((e) => e.user_id).filter(Boolean));
      setTotalUsers(uniqueUsers.size);

      // Daily designs (last 14 days)
      const dailyMap = new Map<string, number>();
      const visitMap = new Map<string, number>();
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        dailyMap.set(key, 0);
        visitMap.set(key, 0);
      }

      designs.forEach((e) => {
        const key = e.created_at.slice(0, 10);
        if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1);
      });

      visits.forEach((e) => {
        const key = e.created_at.slice(0, 10);
        if (visitMap.has(key)) visitMap.set(key, (visitMap.get(key) ?? 0) + 1);
      });

      setDailyDesigns(
        Array.from(dailyMap.entries()).map(([date, count]) => ({
          date: date.slice(5), // MM-DD
          count,
        }))
      );

      setDailyVisits(
        Array.from(visitMap.entries()).map(([date, count]) => ({
          date: date.slice(5),
          count,
        }))
      );

      // Product breakdown
      const prodMap = new Map<string, number>();
      products.forEach((e) => {
        const prod = (e.event_data as any)?.product || "unknown";
        prodMap.set(prod, (prodMap.get(prod) ?? 0) + 1);
      });

      setProductStats(
        Array.from(prodMap.entries())
          .map(([product, count]) => ({ product, count }))
          .sort((a, b) => b.count - a.count)
      );

      setDataLoading(false);
    }

    fetchAnalytics();
  }, [isAdmin, adminLoading, authLoading]);

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
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground">You don't have admin privileges.</p>
        <Button variant="outline" onClick={() => navigate("/")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Go Back
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border p-4">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Analytics Dashboard</h1>
            <p className="text-sm text-muted-foreground">Admin overview</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Designs Generated</CardTitle>
              <Layers className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dataLoading ? "…" : totalDesigns}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Page Visits</CardTitle>
              <Eye className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dataLoading ? "…" : totalVisits}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Products Selected</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dataLoading ? "…" : productStats.reduce((s, p) => s + p.count, 0)}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unique Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{dataLoading ? "…" : totalUsers}</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Daily Designs */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Designs Generated (14 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyDesigns}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Daily Visits */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Page Visits (14 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyVisits}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        color: "hsl(var(--foreground))",
                      }}
                    />
                    <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Product Breakdown */}
        {productStats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Product Selection Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={productStats}
                      dataKey="count"
                      nameKey="product"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ product, count }) => `${product}: ${count}`}
                    >
                      {productStats.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
