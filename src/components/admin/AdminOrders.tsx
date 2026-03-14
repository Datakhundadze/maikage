import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Order {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  product: string;
  sub_product: string | null;
  color: string | null;
  total_price: number;
  product_price: number;
  delivery_price: number;
  delivery_type: string;
  delivery_address: string | null;
  status: string;
  payment_status: string;
  is_studio: boolean;
  comment: string | null;
  created_at: string;
  bog_order_id: string | null;
}

const STATUS_OPTIONS = ["pending", "confirmed", "in_production", "shipped", "delivered", "cancelled"];
const PAYMENT_OPTIONS = ["unpaid", "paid", "failed", "refunded"];

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    fetchOrders();
    intervalRef.current = setInterval(fetchOrders, 60000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [user?.id, authLoading]);

  async function fetchOrders() {
    setLoading(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("[AdminOrders] fetch error:", error);
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    }
    setOrders((data as Order[]) || []);
    setLoading(false);
  }

  async function updateOrder(id: string, field: string, value: string) {
    const updateData: Record<string, string> = { [field]: value };
    if (field === "payment_status" && value === "paid") {
      updateData.paid_at = new Date().toISOString();
    }
    const { error } = await supabase.from("orders").update(updateData).eq("id", id);
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setOrders(prev => prev.map(o => o.id === id ? { ...o, ...updateData } : o));
      toast({ title: "განახლდა" });
    }
  }

  const statusColor = (s: string) => {
    switch (s) {
      case "paid": return "default";
      case "unpaid": return "secondary";
      case "failed": return "destructive";
      case "delivered": return "default";
      case "cancelled": return "destructive";
      default: return "outline";
    }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">შეკვეთები ({orders.length})</h2>
        <Button variant="outline" size="sm" onClick={fetchOrders}>განახლება</Button>
      </div>

      <div className="rounded-lg border border-border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">#</TableHead>
              <TableHead>კლიენტი</TableHead>
              <TableHead>პროდუქტი</TableHead>
              <TableHead>თანხა</TableHead>
              <TableHead>გადახდა</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead>თარიღი</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order, i) => (
              <>
                <TableRow
                  key={order.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                >
                  <TableCell className="font-mono text-xs">{orders.length - i}</TableCell>
                  <TableCell>
                    <div className="font-medium">{order.first_name} {order.last_name}</div>
                    <div className="text-xs text-muted-foreground">{order.email}</div>
                  </TableCell>
                  <TableCell>
                    <div>{order.product}</div>
                    {order.sub_product && <div className="text-xs text-muted-foreground">{order.sub_product}</div>}
                  </TableCell>
                  <TableCell className="font-medium">{(order.total_price / 100).toFixed(0)} ₾</TableCell>
                  <TableCell>
                    <Badge variant={statusColor(order.payment_status) as any}>{order.payment_status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusColor(order.status) as any}>{order.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(order.created_at), "dd.MM.yy HH:mm")}
                  </TableCell>
                </TableRow>
                {expandedId === order.id && (
                  <TableRow key={`${order.id}-detail`}>
                    <TableCell colSpan={7} className="bg-muted/30 p-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">ტელეფონი:</span>
                          <p className="font-medium">{order.phone}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">მიწოდება:</span>
                          <p className="font-medium">{order.delivery_type} ({(order.delivery_price / 100).toFixed(0)} ₾)</p>
                        </div>
                        {order.delivery_address && (
                          <div>
                            <span className="text-muted-foreground">მისამართი:</span>
                            <p className="font-medium">{order.delivery_address}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground">ფერი:</span>
                          <p className="font-medium">{order.color || "—"}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">რეჟიმი:</span>
                          <p className="font-medium">{order.is_studio ? "Studio" : "Simple"}</p>
                        </div>
                        {order.comment && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">კომენტარი:</span>
                            <p className="font-medium">{order.comment}</p>
                          </div>
                        )}
                        {order.bog_order_id && (
                          <div>
                            <span className="text-muted-foreground">BOG ID:</span>
                            <p className="font-mono text-xs">{order.bog_order_id}</p>
                          </div>
                        )}
                        <div className="flex gap-2 items-end col-span-2">
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground">გადახდა</span>
                            <Select value={order.payment_status} onValueChange={v => updateOrder(order.id, "payment_status", v)}>
                              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PAYMENT_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <span className="text-xs text-muted-foreground">სტატუსი</span>
                            <Select value={order.status} onValueChange={v => updateOrder(order.id, "status", v)}>
                              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          შეკვეთები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
