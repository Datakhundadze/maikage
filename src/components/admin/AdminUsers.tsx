import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Ban, CheckCircle, Unlock, Lock } from "lucide-react";

// The generate-design lifetime cap (mirrors check_generation_block: a
// logged-in user with more than this many generations and no paid order is
// limit-blocked, unless is_exempt). Kept in sync with the SQL function.
const GEN_CAP = 10;

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_anonymous: boolean | null;
  is_blocked: boolean;
  is_exempt?: boolean;
  created_at: string;
  email?: string;
  orderCount?: number;
  paidCount?: number;
  genCount?: number;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { toast } = useToast();

  useEffect(() => {
    fetchUsers();
  }, []);

  async function fetchUsers() {
    setLoading(true);
    // is_exempt / generations are admin-readable (admin RLS on generations);
    // schema-ahead-of-types, so the casts below mirror the existing pattern.
    const [profilesRes, ordersRes, gensRes] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("profiles")
        .select("id, user_id, display_name, avatar_url, is_anonymous, is_blocked, is_exempt, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("orders").select("user_id, payment_status"),
      supabase.from("generations").select("user_id"),
    ]);

    const orderCounts = new Map<string, number>();
    const paidCounts = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ordersRes.data || []).forEach((o: any) => {
      if (!o.user_id) return;
      orderCounts.set(o.user_id, (orderCounts.get(o.user_id) ?? 0) + 1);
      if (o.payment_status === "paid") paidCounts.set(o.user_id, (paidCounts.get(o.user_id) ?? 0) + 1);
    });

    const genCounts = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (gensRes.data || []).forEach((g: any) => {
      if (g.user_id) genCounts.set(g.user_id, (genCounts.get(g.user_id) ?? 0) + 1);
    });

    const profiles = ((profilesRes.data as Profile[]) || []).map(p => ({
      ...p,
      orderCount: orderCounts.get(p.user_id) || 0,
      paidCount: paidCounts.get(p.user_id) || 0,
      genCount: genCounts.get(p.user_id) || 0,
    }));
    setUsers(profiles);
    setLoading(false);
    setLastRefresh(new Date());
  }

  async function toggleBlock(userId: string, currentBlocked: boolean) {
    const { error } = await supabase
      .from("profiles")
      .update({ is_blocked: !currentBlocked } as any)
      .eq("user_id", userId);

    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, is_blocked: !currentBlocked } : u));
      toast({ title: currentBlocked ? "განბლოკილია" : "დაბლოკილია" });
    }
  }

  // SEPARATE from the hard block (is_blocked): flips profiles.is_exempt so the
  // user skips the generation-count limit. is_blocked is untouched here.
  async function toggleExempt(userId: string, currentExempt: boolean) {
    const { error } = await supabase
      .from("profiles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ is_exempt: !currentExempt } as any)
      .eq("user_id", userId);

    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setUsers(prev => prev.map(u => u.user_id === userId ? { ...u, is_exempt: !currentExempt } : u));
      toast({ title: currentExempt ? "ლიმიტი დაბრუნდა" : "ლიმიტი მოიხსნა" });
    }
  }

  if (loading) {
    return <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">მომხმარებლები ({users.length})</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}</span>
          <Button variant="outline" size="sm" onClick={fetchUsers}>განახლება</Button>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>მომხმარებელი</TableHead>
              <TableHead>ელ.ფოსტა / ID</TableHead>
              <TableHead>ტიპი</TableHead>
              <TableHead>შეკვეთები</TableHead>
              <TableHead>გენერაცია / ლიმიტი</TableHead>
              <TableHead>სტატუსი</TableHead>
              <TableHead>რეგისტრაცია</TableHead>
              <TableHead className="w-[190px]">მოქმედება</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map(user => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                        {(user.display_name || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <span className="font-medium">{user.display_name || "უსახელო"}</span>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{user.user_id.slice(0, 12)}...</TableCell>
                <TableCell>
                  <Badge variant={user.is_anonymous ? "secondary" : "outline"}>
                    {user.is_anonymous ? "სტუმარი" : "რეგ."}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{user.orderCount || 0}</TableCell>
                <TableCell>
                  {(() => {
                    const gen = user.genCount || 0;
                    const limitBlocked = gen > GEN_CAP && (user.paidCount || 0) === 0 && !user.is_exempt;
                    return (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground">{gen}</span>
                        {user.is_exempt ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-600/30">ლიმიტ. გამორთ.</Badge>
                        ) : limitBlocked ? (
                          <Badge variant="destructive">ლიმიტი ამოწ.</Badge>
                        ) : (
                          <Badge variant="outline" className="text-green-600 border-green-600/30">ok</Badge>
                        )}
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {user.is_blocked ? (
                    <Badge variant="destructive">დაბლოკილი</Badge>
                  ) : (
                    <Badge variant="outline" className="text-green-600 border-green-600/30">აქტიური</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(user.created_at), "dd.MM.yy")}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    {/* Generation-limit exemption (separate from the hard block). */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => toggleExempt(user.user_id, !!user.is_exempt)}
                    >
                      {user.is_exempt ? (
                        <><Lock className="h-3 w-3" /> ლიმიტის დაბრუნება</>
                      ) : (
                        <><Unlock className="h-3 w-3" /> ლიმიტის მოხსნა</>
                      )}
                    </Button>
                    {/* Hard block (is_blocked) — unchanged. */}
                    <Button
                      variant={user.is_blocked ? "outline" : "destructive"}
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => toggleBlock(user.user_id, user.is_blocked)}
                    >
                      {user.is_blocked ? (
                        <><CheckCircle className="h-3 w-3" /> განბლოკვა</>
                      ) : (
                        <><Ban className="h-3 w-3" /> დაბლოკვა</>
                      )}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {users.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          მომხმარებლები არ მოიძებნა
        </div>
      )}
    </div>
  );
}
