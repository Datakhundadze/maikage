import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const COLORS = [
  "#f59e0b", "#10b981", "#8b5cf6", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316",
];

interface Order {
  id: string;
  total_price: number;
  product: string;
  color: string | null;
  created_at: string;
  payment_status: string;
  status: string;
}

export default function AdminAnalytics() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generationsCount, setGenerationsCount] = useState(0);

  const fetchData = async () => {
    const [ordersRes, eventsRes, generationsRes] = await Promise.all([
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("analytics_events").select("event_type, event_data, created_at"),
      supabase.from("generations").select("id", { count: "exact", head: true }),
    ]);
    setOrders((ordersRes.data as Order[]) || []);
    setEvents(eventsRes.data || []);
    setGenerationsCount(generationsRes.count || 0);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const analytics = useMemo(() => {
    const paidOrders = orders.filter(o => o.payment_status === "paid");
    const visits = events.filter(e => e.event_type === "page_visit");
    const designs = events.filter(e => e.event_type === "design_generated");

    // Popular products
    const prodMap = new Map<string, number>();
    orders.forEach(o => {
      prodMap.set(o.product, (prodMap.get(o.product) ?? 0) + 1);
    });
    const popularProducts = Array.from(prodMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Popular colors
    const colorMap = new Map<string, number>();
    orders.forEach(o => {
      const c = o.color || "უცნობი";
      colorMap.set(c, (colorMap.get(c) ?? 0) + 1);
    });
    const popularColors = Array.from(colorMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    // Payment stats
    const paymentMap = new Map<string, number>();
    orders.forEach(o => {
      paymentMap.set(o.payment_status, (paymentMap.get(o.payment_status) ?? 0) + 1);
    });
    const paymentStats = Array.from(paymentMap.entries())
      .map(([name, count]) => ({ name, count }));

    // Conversion: visits → orders (from tracked page_visit events)
    const conversionRate = visits.length > 0 ? ((orders.length / visits.length) * 100).toFixed(1) : "0";
    // Conversion: designs → orders (from actual generations count)
    const designToOrderRate = generationsCount > 0 ? ((orders.length / generationsCount) * 100).toFixed(1) : "0";

    return { popularProducts, popularColors, paymentStats, conversionRate, designToOrderRate, totalVisits: visits.length, totalDesigns: generationsCount };
  }, [orders, events, generationsCount]);

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const tooltipStyle = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 8,
    color: "hsl(var(--foreground))",
  };

  return (
    <div className="space-y-6">
      {/* Conversion Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">ვიზიტი → შეკვეთა</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.conversionRate}%</div>
            <p className="text-xs text-muted-foreground">{analytics.totalVisits} ვიზიტი</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">დიზაინი → შეკვეთა</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{analytics.designToOrderRate}%</div>
            <p className="text-xs text-muted-foreground">{analytics.totalDesigns} დიზაინი</p>
          </CardContent>
        </Card>
        {analytics.paymentStats.map(ps => (
          <Card key={ps.name}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground capitalize">{ps.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{ps.count}</div>
              <p className="text-xs text-muted-foreground">შეკვეთა</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Popular Products */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ყველაზე პოპულარული პროდუქტები</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.popularProducts.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.popularProducts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis dataKey="name" type="category" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} name="რაოდენობა" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">მონაცემები არ არის</p>
            )}
          </CardContent>
        </Card>

        {/* Popular Colors */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ყველაზე პოპულარული ფერები</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.popularColors.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={analytics.popularColors} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, count }) => `${name}: ${count}`}>
                      {analytics.popularColors.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm py-8 text-center">მონაცემები არ არის</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment Stats Pie */}
      {analytics.paymentStats.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">გადახდების სტატისტიკა</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={analytics.paymentStats} dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, count }) => `${name}: ${count}`}>
                    {analytics.paymentStats.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
