import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { useDesignStorage } from "@/hooks/useDesignStorage";
import { getGuestSessionId } from "@/lib/guestSession";
import AppLayout from "@/components/AppLayout";
import OrderCard from "@/components/OrderCard";
import { Button } from "@/components/ui/button";
import { Trash2, Eye } from "lucide-react";
import {
  groupOrdersByCart,
  CUSTOMER_ORDER_COLUMNS,
  type CustomerOrder,
  type OrderGroup,
} from "@/lib/orderGrouping";
const Lightbox = lazy(() => import("@/components/Lightbox"));
import SeoHead, { SITE_URL } from "@/components/SeoHead";

interface Design {
  id: string;
  title: string;
  prompt: string | null;
  product: string;
  color: string;
  mockup_image_path: string | null;
  transparent_image_path: string | null;
  is_published: boolean;
  likes_count: number;
  created_at: string;
}

interface Generation {
  id: string;
  prompt: string | null;
  product: string;
  color: string;
  mockup_image_path: string | null;
  transparent_image_path: string | null;
  created_at: string;
}

type AccountTab = "designs" | "orders";

function resolveImageUrl(path: string | null) {
  if (!path) return null;
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const { data } = supabase.storage.from("designs").getPublicUrl(path);
  return data.publicUrl;
}

export default function MyDesignsPage() {
  const { user, isAnonymous } = useAuth();
  const { lang } = useAppState();
  const { deleteDesign } = useDesignStorage();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<AccountTab>(searchParams.get("tab") === "orders" ? "orders" : "designs");
  const [designs, setDesigns] = useState<Design[]>([]);
  const [guestGenerations, setGuestGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Orders tab
  const isLoggedIn = !!user && !isAnonymous;
  const [orderGroups, setOrderGroups] = useState<OrderGroup<CustomerOrder>[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const fetchDesigns = useCallback(async () => {
    setLoading(true);

    if (user) {
      // Logged-in users: only show designs table (auto-saved on generation)
      const { data } = await supabase
        .from("designs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setDesigns((data as Design[]) || []);
      setGuestGenerations([]);
    } else {
      // Guest users: show generations by session via a sanitized
      // SECURITY DEFINER RPC. The generations table no longer has a public
      // SELECT policy (it exposed user_id / session_id / prompts to any
      // anon caller); the RPC returns only this session's rows with no
      // user_id / session_id / is_guest.
      setDesigns([]);
      const sessionId = getGuestSessionId();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated Supabase types lag the new RPC; cast mirrors the admin (supabase as any) convention
      const { data: genData } = await (supabase as any).rpc(
        "get_generations_by_session",
        { p_session_id: sessionId },
      );
      setGuestGenerations((genData as Generation[]) || []);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => { fetchDesigns(); }, [fetchDesigns]);

  // Orders: logged-in only (RLS "Users can read own orders"). Group by cart_id
  // so a multi-unit checkout collapses into one card. Guests see a login state.
  const fetchOrders = useCallback(async () => {
    if (!isLoggedIn || !user) { setOrderGroups(null); return; }
    setOrdersLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(CUSTOMER_ORDER_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setOrderGroups(groupOrdersByCart((data as unknown as CustomerOrder[]) || []));
    setOrdersLoading(false);
  }, [isLoggedIn, user]);

  useEffect(() => {
    if (tab === "orders" && orderGroups === null && isLoggedIn) fetchOrders();
  }, [tab, orderGroups, isLoggedIn, fetchOrders]);

  const handleDelete = async (d: Design) => {
    if (!confirm(t(lang, "myDesigns.deleteConfirm"))) return;
    const ok = await deleteDesign(d.id, d.transparent_image_path, d.mockup_image_path);
    if (ok) setDesigns((prev) => prev.filter((x) => x.id !== d.id));
  };

  const totalCount = designs.length + guestGenerations.length;
  const orderCount = orderGroups?.length ?? 0;

  const tabButton = (id: AccountTab, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <SeoHead
        title="ჩემი დიზაინები — Maika.ge"
        description="შენი შენახული დიზაინები და შეკვეთები Maika.ge-ზე."
        url={`${SITE_URL}/my-designs`}
        noindex
      />
      <AppLayout
        mainOnMobile
        sidebar={
          <div className="space-y-4">
            <h2 className="text-lg font-bold">{t(lang, "myDesigns.title")}</h2>
            <div className="flex gap-1 rounded-xl bg-muted p-1">
              {tabButton("designs", t(lang, "orders.designsTab"))}
              {tabButton("orders", t(lang, "orders.ordersTab"))}
            </div>
            <p className="text-sm text-muted-foreground">
              {tab === "designs"
                ? t(lang, "myDesigns.count", totalCount)
                : t(lang, "orders.count", orderCount)}
            </p>
          </div>
        }
        main={
          tab === "designs" ? (
            <div className="p-6">
              {loading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : totalCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <p className="text-lg">{t(lang, "myDesigns.empty")}</p>
                  <p className="text-sm">{t(lang, "myDesigns.emptyHint")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Saved designs (with full controls) */}
                  {designs.map((d, idx) => (
                    <div key={d.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
                      <div className="relative aspect-square bg-muted">
                        {resolveImageUrl(d.mockup_image_path) && (
                          <img
                            src={resolveImageUrl(d.mockup_image_path)!}
                            alt={d.title}
                            width={800}
                            height={800}
                            className="w-full h-full object-contain"
                            loading={idx === 0 ? "eager" : "lazy"}
                            fetchPriority={idx === 0 ? "high" : "auto"}
                          />
                        )}
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <Button size="sm" variant="secondary" onClick={() => { const u = resolveImageUrl(d.mockup_image_path); if (u) setLightboxSrc(u); }}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => handleDelete(d)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-sm font-medium line-clamp-3 whitespace-pre-wrap">{d.prompt || d.title}</p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground">{d.product} · {d.color}</span>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span>♥ {d.likes_count}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Guest/session generations (view only) */}
                  {guestGenerations.map((g) => {
                    const imgUrl = resolveImageUrl(g.mockup_image_path) || resolveImageUrl(g.transparent_image_path);
                    return (
                      <div key={g.id} className="rounded-2xl border border-border bg-card overflow-hidden group">
                        <div className="relative aspect-square bg-muted">
                          {imgUrl && (
                            <img
                              src={imgUrl}
                              alt={g.prompt || "Generation"}
                              width={800}
                              height={800}
                              className="w-full h-full object-contain"
                              loading="lazy"
                            />
                          )}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="sm" variant="secondary" onClick={() => imgUrl && setLightboxSrc(imgUrl)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium line-clamp-3 whitespace-pre-wrap">{g.prompt || "Untitled"}</p>
                          <span className="text-xs text-muted-foreground">{g.product} · {g.color}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* ── Orders tab ── */
            <div className="p-6">
              {!isLoggedIn ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <p className="text-lg">{t(lang, "orders.loginPrompt")}</p>
                </div>
              ) : ordersLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              ) : orderCount === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <p className="text-lg">{t(lang, "orders.empty")}</p>
                  <p className="text-sm">{t(lang, "orders.emptyHint")}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
                  {orderGroups!.map((g) => <OrderCard key={g.key} group={g} lang={lang} />)}
                </div>
              )}
            </div>
          )
        }
      />
      {lightboxSrc && (
        <Suspense fallback={null}>
          <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
        </Suspense>
      )}
    </>
  );
}
