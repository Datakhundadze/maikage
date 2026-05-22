import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2 } from "lucide-react";

// All fields are read-only here. This tab never writes to catalog_designs.
interface DesignRow {
  id: string;
  slug: string;
  title_ka: string;
  thumbnail_url: string | null;
  category: string | null;
  tags: string[] | null;
  description_ka: string | null;
  meta_description_ka: string | null;
  is_published: boolean;
}

type MissingField = "meta" | "description" | "category" | "tags";

const BRAND_GREEN = "#26BB89";

function isBlank(s: string | null | undefined): boolean {
  return !s || s.trim().length === 0;
}

function tagsMissing(t: string[] | null | undefined): boolean {
  if (!t) return true;
  return t.filter((x) => x.trim().length > 0).length === 0;
}

function missingFor(d: DesignRow): MissingField[] {
  const m: MissingField[] = [];
  if (isBlank(d.meta_description_ka)) m.push("meta");
  if (isBlank(d.description_ka)) m.push("description");
  if (isBlank(d.category)) m.push("category");
  if (tagsMissing(d.tags)) m.push("tags");
  return m;
}

const MISSING_LABEL: Record<MissingField, string> = {
  meta: "meta",
  description: "description",
  category: "category",
  tags: "tags",
};

function percent(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  healthy?: boolean;
  neutral?: boolean;
}

function MetricCard({ label, value, sub, healthy, neutral }: MetricCardProps) {
  // Healthy = brand green border + tint. Unhealthy = amber warning. Neutral
  // (e.g. "drafts" — informational, not pass/fail) = plain border.
  const tone = neutral
    ? "border-border bg-card"
    : healthy
      ? "border-[#26BB89]/30 bg-[#26BB89]/5"
      : "border-amber-500/40 bg-amber-500/5";
  const valueTone = neutral
    ? "text-foreground"
    : healthy
      ? "text-[#26BB89]"
      : "text-amber-500";
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${valueTone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export default function AdminSEO() {
  const [designs, setDesigns] = useState<DesignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { toast } = useToast();

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("catalog_designs")
      .select("id, slug, title_ka, thumbnail_url, category, tags, description_ka, meta_description_ka, is_published")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setDesigns(((data ?? []) as unknown as DesignRow[]));
    }
    setLoading(false);
    setLastRefresh(new Date());
  }

  const metrics = useMemo(() => {
    const published = designs.filter((d) => d.is_published);
    const drafts = designs.filter((d) => !d.is_published);
    const withMeta = published.filter((d) => !isBlank(d.meta_description_ka)).length;
    const withDesc = published.filter((d) => !isBlank(d.description_ka)).length;
    const missingCategoryOrTags = published.filter(
      (d) => isBlank(d.category) || tagsMissing(d.tags),
    ).length;
    return {
      publishedTotal: published.length,
      draftsTotal: drafts.length,
      withMeta,
      withDesc,
      missingCategoryOrTags,
    };
  }, [designs]);

  // Anything (published OR draft) that's missing one of the four tracked
  // fields. Showing drafts too is intentional — the workflow is "upload,
  // fill fields, then publish", so an incomplete draft is the most common
  // actionable item.
  const incompleteRows = useMemo(() => {
    return designs
      .map((d) => ({ design: d, missing: missingFor(d) }))
      .filter((r) => r.missing.length > 0);
  }, [designs]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const allHealthy =
    metrics.withMeta === metrics.publishedTotal &&
    metrics.withDesc === metrics.publishedTotal &&
    metrics.missingCategoryOrTags === 0 &&
    metrics.publishedTotal > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">SEO ჯანმრთელობა</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            ბოლო: {lastRefresh.toLocaleTimeString("ka-GE")}
          </span>
          <Button variant="outline" size="sm" onClick={load}>განახლება</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          label="გამოქვეყნებული დიზაინები"
          value={String(metrics.publishedTotal)}
          neutral
        />
        <MetricCard
          label="meta_description_ka"
          value={`${metrics.withMeta} / ${metrics.publishedTotal}`}
          sub={percent(metrics.withMeta, metrics.publishedTotal)}
          healthy={metrics.withMeta === metrics.publishedTotal && metrics.publishedTotal > 0}
        />
        <MetricCard
          label="description_ka"
          value={`${metrics.withDesc} / ${metrics.publishedTotal}`}
          sub={percent(metrics.withDesc, metrics.publishedTotal)}
          healthy={metrics.withDesc === metrics.publishedTotal && metrics.publishedTotal > 0}
        />
        <MetricCard
          label="დრაფტები"
          value={String(metrics.draftsTotal)}
          sub="ჯერ არ გამოქვეყნებული"
          neutral
        />
        <MetricCard
          label="კატეგ./თეგების გარეშე"
          value={String(metrics.missingCategoryOrTags)}
          sub="გამოქვეყნებულებში"
          healthy={metrics.missingCategoryOrTags === 0}
        />
      </div>

      {incompleteRows.length === 0 ? (
        <div
          className="rounded-lg border border-[#26BB89]/30 bg-[#26BB89]/5 p-6 text-center"
        >
          <CheckCircle2 className="mx-auto h-8 w-8" style={{ color: BRAND_GREEN }} />
          <p className="mt-2 text-sm font-medium" style={{ color: BRAND_GREEN }}>
            {allHealthy
              ? "ყველა გამოქვეყნებული დიზაინი სრულადაა შევსებული ✓"
              : "ყველა დიზაინს აქვს ყველა SEO ველი შევსებული ✓"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">
              შესავსები დიზაინები ({incompleteRows.length})
            </h3>
            <span className="text-xs text-muted-foreground">
              გამოქვეყნებული + დრაფტები
            </span>
          </div>
          <div className="rounded-lg border border-border overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]"></TableHead>
                  <TableHead>სათაური</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>აკლია</TableHead>
                  <TableHead className="w-[120px]">სტატუსი</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incompleteRows.map(({ design, missing }) => (
                  <TableRow key={design.id}>
                    <TableCell>
                      {design.thumbnail_url ? (
                        <img
                          src={design.thumbnail_url}
                          alt=""
                          className="h-10 w-10 rounded border border-border object-cover bg-muted"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded border border-border bg-muted" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{design.title_ka}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {design.slug}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {missing.map((m) => (
                          <Badge
                            key={m}
                            variant="outline"
                            className="text-amber-500 border-amber-500/40 text-[10px]"
                          >
                            {MISSING_LABEL[m]}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {design.is_published ? (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          style={{ color: BRAND_GREEN, borderColor: `${BRAND_GREEN}4D` }}
                        >
                          გამოქვეყნებული
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          დრაფტი
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
