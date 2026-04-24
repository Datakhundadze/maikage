import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Download, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

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
  front_mockup_url: string | null;
  back_mockup_url: string | null;
  transparent_image_url: string | null;
  back_transparent_image_url: string | null;
  prompt: string | null;
  size: string | null;
  paid_at: string | null;
}

const STATUS_OPTIONS = ["pending", "confirmed", "in_production", "shipped", "delivered", "cancelled"];
const PAYMENT_OPTIONS = ["unpaid", "paid", "failed", "refunded"];

const PAYMENT_LABELS: Record<string, string> = {
  unpaid: "გადაუხდელი",
  paid: "გადახდილია",
  failed: "გადახდა ვერ განხორციელდა",
  refunded: "დაბრუნებული",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "მოლოდინში",
  confirmed: "დადასტურებული",
  in_production: "წარმოებაში",
  shipped: "გაგზავნილი",
  delivered: "მიტანილი",
  cancelled: "გაუქმებული",
};

const DELIVERY_LABELS: Record<string, string> = {
  pickup: "მაღაზიიდან გატანა",
  courier_tbilisi: "კურიერი თბილისში",
  courier_outside: "კურიერი რეგიონში",
};

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch {
    window.open(url, "_blank");
  }
}

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [originalPhotos, setOriginalPhotos] = useState<Record<string, { name: string; url: string }[]>>({});
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();

  // Load full-resolution originals uploaded to order-originals/{orderId}/ when a row expands
  useEffect(() => {
    if (!expandedId || originalPhotos[expandedId]) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.storage
        .from("designs")
        .list(`order-originals/${expandedId}`, { limit: 50 });
      if (cancelled) return;
      if (error || !data) {
        setOriginalPhotos((prev) => ({ ...prev, [expandedId]: [] }));
        return;
      }
      const files = data
        .filter((f) => f.name && !f.name.startsWith("."))
        .map((f) => {
          const { data: pub } = supabase.storage
            .from("designs")
            .getPublicUrl(`order-originals/${expandedId}/${f.name}`);
          return { name: f.name, url: pub.publicUrl };
        });
      setOriginalPhotos((prev) => ({ ...prev, [expandedId]: files }));
    })();
    return () => { cancelled = true; };
  }, [expandedId, originalPhotos]);

  useEffect(() => {
    if (authLoading) return;
    fetchOrders();
  }, [user?.id, authLoading]);

  async function fetchOrders() {
    setLoading(true);
    const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
    if (error) {
      console.error("[AdminOrders] fetch error:", error);
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    }
    const rows = (data as any as Order[]) || [];
    setOrders(rows);
    setLoading(false);
    setLastRefresh(new Date());

    // Auto-sync any non-paid orders that have a BOG order id — catches cases where
    // the BOG webhook didn't update our DB but payment actually succeeded.
    const unsynced = rows.filter(
      (o) => o.bog_order_id && o.payment_status !== "paid" && o.payment_status !== "refunded"
    );
    if (unsynced.length > 0) {
      const updates = await Promise.allSettled(
        unsynced.map(async (o) => {
          const { data: res } = await supabase.functions.invoke("check-payment", { body: { orderId: o.id } });
          return { id: o.id, res };
        })
      );
      let paidCount = 0;
      setOrders((prev) =>
        prev.map((o) => {
          const match = updates.find(
            (u) => u.status === "fulfilled" && (u.value as any)?.id === o.id
          ) as PromiseFulfilledResult<{ id: string; res: any }> | undefined;
          if (!match) return o;
          if (match.value.res?.status === "paid") {
            paidCount += 1;
            return { ...o, payment_status: "paid", status: "confirmed", paid_at: o.paid_at || new Date().toISOString() };
          }
          if (match.value.res?.status === "failed") {
            return { ...o, payment_status: "failed" };
          }
          return o;
        })
      );
      if (paidCount > 0) toast({ title: `გადახდა სინქრონიზდა ${paidCount} შეკვეთისთვის ✓` });
    }
  }

  const [checkingPayment, setCheckingPayment] = useState<string | null>(null);

  async function checkPayment(orderId: string) {
    setCheckingPayment(orderId);
    try {
      const { data, error } = await supabase.functions.invoke("check-payment", {
        body: { orderId },
      });
      if (error) throw new Error(error.message);
      if (data?.status === "paid") {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, payment_status: "paid", status: "confirmed", paid_at: new Date().toISOString() } : o));
        toast({ title: "გადახდა დადასტურდა ✓" });
      } else if (data?.status === "failed") {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, payment_status: "failed" } : o));
        toast({ title: "გადახდა ვერ განხორციელდა", variant: "destructive" });
      } else {
        toast({ title: "სტატუსი", description: `BOG: ${data?.bog_status || data?.status || "unknown"}` });
      }
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
    }
    setCheckingPayment(null);
  }

  async function updateOrder(id: string, field: string, value: string) {
    const { data, error } = await supabase.rpc("admin_update_order", {
      p_order_id: id,
      p_field: field,
      p_value: value,
    });
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
      return;
    }
    if (!data) {
      toast({ title: "შეკვეთა ვერ მოიძებნა", variant: "destructive" });
      return;
    }
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...(data as any) } : o));
    toast({ title: "განახლდა" });
  }

  const paymentBadgeVariant = (s: string) => {
    switch (s) {
      case "paid": return "default";
      case "failed": return "destructive";
      default: return "secondary";
    }
  };

  const statusBadgeVariant = (s: string) => {
    switch (s) {
      case "delivered": return "default";
      case "cancelled": return "destructive";
      case "shipped": return "default";
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
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}</span>
          <Button variant="outline" size="sm" onClick={fetchOrders}>განახლება</Button>
        </div>
      </div>

      <div className="space-y-3">
        {orders.map((order, i) => {
          const isExpanded = expandedId === order.id;
          return (
            <div key={order.id} className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Summary row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="text-xs font-mono text-muted-foreground w-8">#{orders.length - i}</span>
                {order.front_mockup_url ? (
                  <div className="w-10 h-10 rounded border border-border bg-muted overflow-hidden flex-shrink-0">
                    <img src={order.front_mockup_url} alt="" className="w-full h-full object-contain" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded border border-border bg-muted flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{order.first_name} {order.last_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {order.product} {order.sub_product ? `• ${order.sub_product}` : ""} • {order.color || "—"}
                    {order.size ? ` • ${order.size}` : <span className="text-destructive"> • ზომა არ არის არჩეული</span>}
                  </div>
                </div>
                <div className="text-sm font-semibold">{order.total_price} ₾</div>
                <Badge variant={paymentBadgeVariant(order.payment_status) as any} className="text-[10px]">
                  {PAYMENT_LABELS[order.payment_status] || order.payment_status}
                </Badge>
                <Badge variant={statusBadgeVariant(order.status) as any} className="text-[10px]">
                  {STATUS_LABELS[order.status] || order.status}
                </Badge>
                <span className="text-xs text-muted-foreground hidden sm:block">{format(new Date(order.created_at), "dd.MM.yy HH:mm")}</span>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-border bg-muted/30 p-4 space-y-4">
                  {/* Customer info */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">კლიენტი</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">სახელი:</span>
                        <p className="font-medium">{order.first_name} {order.last_name}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ელ.ფოსტა:</span>
                        <p className="font-medium">{order.email}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">ტელეფონი:</span>
                        <p className="font-medium">{order.phone}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">მიწოდება:</span>
                        <p className="font-medium">{DELIVERY_LABELS[order.delivery_type] || order.delivery_type}</p>
                      </div>
                      {order.delivery_address && (
                        <div className="col-span-2">
                          <span className="text-muted-foreground">მისამართი:</span>
                          <p className="font-medium">{order.delivery_address}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Product info */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">პროდუქტი</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">ტიპი:</span>
                        <p className="font-medium">{order.product}</p>
                      </div>
                      {order.sub_product && (
                        <div>
                          <span className="text-muted-foreground">ბრენდი:</span>
                          <p className="font-medium">{order.sub_product}</p>
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
                      <div>
                        <span className="text-muted-foreground">
                          {order.product === "Phone Case" ? "მოდელი:" : "ზომა:"}
                        </span>
                        <p className={`font-medium ${!order.size ? "text-destructive" : ""}`}>
                          {order.size || "არ არის არჩეული"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Prompt / design text */}
                  {order.prompt && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase">{order.is_studio ? "პრომპტი" : "დიზაინის ტექსტი"}</h4>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(order.prompt || "");
                              toast({ title: "დაკოპირდა" });
                            } catch {
                              toast({ title: "ვერ დაკოპირდა", variant: "destructive" });
                            }
                          }}
                        >
                          დაკოპირება
                        </Button>
                      </div>
                      <pre className="text-sm bg-background rounded-lg p-3 border border-border whitespace-pre-wrap font-sans">{order.prompt}</pre>
                    </div>
                  )}

                  {/* Design mockups */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">დიზაინი</h4>
                    {order.front_mockup_url || order.back_mockup_url ? (
                      <div className="flex gap-4 flex-wrap">
                        {order.front_mockup_url && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">წინა მხარე</p>
                            <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                              <img src={order.front_mockup_url} alt="წინა მხარე" className="w-full h-full object-contain" />
                            </div>
                            <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                              onClick={() => downloadImage(order.front_mockup_url!, `order-${order.id}-front.png`)}>
                              <Download className="h-3 w-3" /> ჩამოტვირთვა
                            </Button>
                          </div>
                        )}
                        {order.back_mockup_url && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-muted-foreground">უკანა მხარე</p>
                            <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                              <img src={order.back_mockup_url} alt="უკანა მხარე" className="w-full h-full object-contain" />
                            </div>
                            <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                              onClick={() => downloadImage(order.back_mockup_url!, `order-${order.id}-back.png`)}>
                              <Download className="h-3 w-3" /> ჩამოტვირთვა
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">პრევიუ არ არის</p>
                    )}
                    {(order.transparent_image_url || order.back_transparent_image_url) && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1.5">ორიგინალი დიზაინი (პრინტ ფაილი)</p>
                        <div className="flex gap-4 flex-wrap">
                          {order.transparent_image_url && (
                            <div className="space-y-1.5">
                              <p className="text-xs text-muted-foreground">წინა მხარე</p>
                              <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                                <img src={order.transparent_image_url} alt="წინა პრინტი" className="w-full h-full object-contain" />
                              </div>
                              <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                onClick={() => downloadImage(order.transparent_image_url!, `order-${order.id}-print-front.png`)}>
                                <Download className="h-3 w-3" /> პრინტ ფაილი
                              </Button>
                            </div>
                          )}
                          {order.back_transparent_image_url && (
                            <div className="space-y-1.5">
                              <p className="text-xs text-muted-foreground">უკანა მხარე</p>
                              <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                                <img src={order.back_transparent_image_url} alt="უკანა პრინტი" className="w-full h-full object-contain" />
                              </div>
                              <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                onClick={() => downloadImage(order.back_transparent_image_url!, `order-${order.id}-print-back.png`)}>
                                <Download className="h-3 w-3" /> პრინტ ფაილი
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {originalPhotos[order.id] && originalPhotos[order.id].length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border">
                        <p className="text-xs text-muted-foreground mb-1.5">ორიგინალი ფოტოები (სრული რეზოლუცია)</p>
                        <div className="flex gap-3 flex-wrap">
                          {originalPhotos[order.id].map((photo, i) => (
                            <div key={photo.name} className="space-y-1.5">
                              <p className="text-xs text-muted-foreground">{photo.name.startsWith("back") ? "უკანა" : "წინა"} #{i + 1}</p>
                              <div className="w-40 h-40 rounded-lg border border-border bg-background overflow-hidden">
                                <img src={photo.url} alt={photo.name} className="w-full h-full object-contain" />
                              </div>
                              <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1"
                                onClick={() => downloadImage(photo.url, `order-${order.id}-${photo.name}`)}>
                                <Download className="h-3 w-3" /> ორიგინალი
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Comment */}
                  {order.comment && (
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">კომენტარი</h4>
                      <p className="text-sm">{order.comment}</p>
                    </div>
                  )}

                  {/* Price breakdown */}
                  <div>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">ფასი</h4>
                    <div className="text-sm space-y-1 bg-background rounded-lg p-3 border border-border max-w-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">პროდუქტი:</span>
                        <span>{order.product_price} ₾</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">მიწოდება:</span>
                        <span>{order.delivery_price === 0 ? "უფასო" : `${order.delivery_price} ₾`}</span>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1 font-bold">
                        <span>სულ:</span>
                        <span>{order.total_price} ₾</span>
                      </div>
                    </div>
                  </div>

                  {/* BOG ID */}
                  {order.bog_order_id && (
                    <div className="text-xs text-muted-foreground">
                      BOG Order ID: <span className="font-mono">{order.bog_order_id}</span>
                    </div>
                  )}

                  {/* Status controls */}
                  <div className="flex gap-3 items-end flex-wrap pt-2 border-t border-border">
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">გადახდა</span>
                      <Select value={order.payment_status} onValueChange={v => updateOrder(order.id, "payment_status", v)}>
                        <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAYMENT_OPTIONS.map(o => <SelectItem key={o} value={o}>{PAYMENT_LABELS[o] || o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <span className="text-xs text-muted-foreground">სტატუსი</span>
                      <Select value={order.status} onValueChange={v => updateOrder(order.id, "status", v)}>
                        <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map(o => <SelectItem key={o} value={o}>{STATUS_LABELS[o] || o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {order.payment_status !== "paid" && order.bog_order_id && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        disabled={checkingPayment === order.id}
                        onClick={() => checkPayment(order.id)}
                      >
                        <RefreshCw className={`h-3 w-3 ${checkingPayment === order.id ? "animate-spin" : ""}`} />
                        გადახდის შემოწმება
                      </Button>
                    )}
                    {order.paid_at && (
                      <span className="text-xs text-emerald-500 self-end pb-1.5">
                        გადახდილია: {format(new Date(order.paid_at), "dd.MM.yy HH:mm")}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {orders.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          შეკვეთები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
