import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

interface Inquiry {
  id: string;
  company_name: string;
  tax_id: string;
  contact_person: string;
  phone: string;
  email: string;
  tshirt_quantity: number;
  color: string | null;
  comment: string | null;
  logo_path: string | null;
  status: string;
  created_at: string;
}

export default function AdminCorporate() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchInquiries = useCallback(async (bg = false) => {
    if (!bg) setInitialLoading(true);
    const { data } = await supabase
      .from("corporate_inquiries")
      .select("*")
      .order("created_at", { ascending: false });
    setInquiries((data as Inquiry[]) || []);
    if (!bg) setInitialLoading(false);
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchInquiries(false);
  }, [fetchInquiries]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("corporate_inquiries" as any).update({ status }).eq("id", id);
    setInquiries((prev) => prev.map((i) => i.id === id ? { ...i, status } : i));
  };

  if (initialLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">კორპორატიული მოთხოვნები ({inquiries.length})</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}</span>
          <Button variant="outline" size="sm" onClick={() => fetchInquiries(false)}>განახლება</Button>
        </div>
      </div>

      <div className="space-y-3">
        {inquiries.map((inq) => (
          <div key={inq.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{inq.company_name}</h3>
                <p className="text-xs text-muted-foreground">ს/კ: {inq.tax_id} · {format(new Date(inq.created_at), "dd.MM.yy HH:mm")}</p>
              </div>
              <Badge variant={inq.status === "new" ? "default" : inq.status === "contacted" ? "secondary" : "outline"}>
                {inq.status}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">საკონტაქტო:</span> {inq.contact_person}</div>
              <div><span className="text-muted-foreground">ტელ:</span> {inq.phone}</div>
              <div><span className="text-muted-foreground">ელ.ფოსტა:</span> {inq.email}</div>
              <div><span className="text-muted-foreground">რაოდენობა:</span> {inq.tshirt_quantity}</div>
              {inq.color && <div><span className="text-muted-foreground">ფერი:</span> {inq.color}</div>}
            </div>
            {inq.comment && <p className="text-sm text-muted-foreground">{inq.comment}</p>}
            {inq.logo_path && (
              <a
                href={supabase.storage.from("corporate-logos").getPublicUrl(inq.logo_path).data.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline"
              >
                ლოგოს ნახვა
              </a>
            )}
            <div className="flex gap-2 pt-1">
              {inq.status === "new" && (
                <Button size="sm" variant="outline" onClick={() => updateStatus(inq.id, "contacted")}>
                  დაკავშირებული
                </Button>
              )}
              {inq.status !== "done" && (
                <Button size="sm" variant="outline" onClick={() => updateStatus(inq.id, "done")}>
                  დასრულებული
                </Button>
              )}
            </div>
          </div>
        ))}
        {inquiries.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">მოთხოვნები არ მოიძებნა</div>
        )}
      </div>
    </div>
  );
}
