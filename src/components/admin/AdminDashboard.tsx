import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Eye, Users, DollarSign, ShoppingCart, TrendingUp } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area,
} from "recharts";

const COLORS = [
  "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

interface Order {
  id: string;
  total_price: number;
  product: string;
  created_at: string;
  payment_status: string;
  status: string;
}

export default function AdminDashboard() {
  const [events, setEvents] = useState<any[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const [eventsRes, ordersRes] = await Promise.all([
        supabase.from("analytics_events").select("event_type, event_data, created_at, user_id").order("created_at", { ascending: true }),
        supabase.from("orders").select("*").order("created_at", { ascending: false }),
      ]);
      setEvents(eventsRes.data || []);
      setOrders((ordersRes.data as Order[]) || []);
      setLoading(false);
    }
    fetch();
  }, []);

  const stats = useMemo(() => {
    const designs = events.filter(e => e.event_type === "design_generated");
    const visits = events.filter(e => e.event_type === "page_visit");
    const products = events.filter(e => e.event_type === "product_selected");
    const uniqueUsers = new Set(events.map(e => e.user_id).filter(Boolean));

    const paidOrders = orders.filter(o => o.payment_status === "paid");
    const totalRevenue = paidOrders.reduce((s, o) => s + (o.total_price || 0), 0);

    // Daily data (30 days)
    const now = new Date();
    const dailyDesigns: { date: string; count: number }[] = [];
    const dailyVisits: { date: string; count: number }[] = [];
    const dailyRevenue: { date: string; revenue: number; orders: number }[] = [];

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = key.slice(5);

      const dCount = designs.filter(e => e.created_at.slice(0, 10) === key).length;
      const vCount = visits.filter(e => e.created_at.slice(0, 10) === key).length;
      const dayOrders = paidOrders.filter(o => o.created_at.slice(0, 10) === key);
      const dayRev = dayOrders.reduce((s, o) => s + (o.total_price || 0), 0);

      dailyDesigns.push({ date: label, count: dCount });
      dailyVisits.push({ date: label, count: vCount });
      dailyRevenue.push({ date: label, revenue: dayRev / 100, orders: dayOrders.length });
    }

    // Product breakdown
    const prodMap = new Map<string, number>();
    products.forEach(e => {
      const prod = (e.event_data as any)?.product || "unknown";
      prodMap.set(prod, (prodMap.get(prod) ?? 0) + 1);
    });
    const productStats = Array.from(prodMap.entries())
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count);

    // Order product breakdown
    const orderProdMap = new Map<string, number>();
    paidOrders.forEach(o => {
      orderProdMap.set(o.product, (orderProdMap.get(o.product) ?? 0) + 1);
    });
    const orderProductStats = Array.from(orderProdMap.entries())
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count);

    const conversionRate = visits.length > 0 ? ((designs.length / visits.length) * 100).toFixed(1) : "0";

    return {
      totalDesigns: designs.length,
      totalVisits: visits.length,
      totalUsers: uniqueUsers.size,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      totalRevenue,
      conversionRate,
      dailyDesigns,
      dailyVisits,
      dailyRevenue,
      productStats,
      orderProductStats,
    };
  }, [events, orders]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    color: "hsl(var(--foreground))",
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">შემოსავალი</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats.totalRevenue / 100).toFixed(0)} ₾</div>
            <p className="text-xs text-muted-foreground">{stats.paidOrders} გადახდილი</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">შეკვეთები</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <p className="text-xs text-muted-foreground">სულ</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">დიზაინები</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalDesigns}</div>
            <p className="text-xs text-muted-foreground">გენერირებული</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">კონვერსია</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.conversionRate}%</div>
            <p className="text-xs text-muted-foreground">ვიზიტი → დიზაინი</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ვიზიტები</CardTitle>
            <Eye className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalVisits}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">მომხმარებლები</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">შემოსავალი (30 დღე)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.dailyRevenue}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="revenue" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.15} strokeWidth={2} name="₾" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">დიზაინები (30 დღე)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.dailyDesigns}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ვიზიტები (30 დღე)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.dailyVisits}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Product Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {stats.productStats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">პროდუქტის არჩევანი</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.productStats} dataKey="count" nameKey="product" cx="50%" cy="50%" outerRadius={90} label={({ product, count }) => `${product}: ${count}`}>
                      {stats.productStats.map((_, i) => (
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
        {stats.orderProductStats.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">შეკვეთილი პროდუქტები</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={stats.orderProductStats} dataKey="count" nameKey="product" cx="50%" cy="50%" outerRadius={90} label={({ product, count }) => `${product}: ${count}`}>
                      {stats.orderProductStats.map((_, i) => (
                        <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
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
