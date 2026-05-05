import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const RECOMMENDED = [
  { slug: "georgian", label: "ქართული" },
  { slug: "sports",   label: "სპორტი" },
  { slug: "humor",    label: "იუმორი" },
  { slug: "anime",    label: "ანიმე" },
  { slug: "food",     label: "საკვები" },
  { slug: "gym",      label: "ტრენაჟორი" },
  { slug: "tech",     label: "ტექ" },
  { slug: "seasonal", label: "სეზონური" },
];

interface CategoryStat {
  category: string;
  count: number;
}

export default function CatalogCategories() {
  const [stats, setStats] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data } = await (supabase as any)
        .from("catalog_designs")
        .select("category");
      const counts = new Map<string, number>();
      ((data || []) as { category: string | null }[]).forEach((d) => {
        const c = d.category || "(uncategorized)";
        counts.set(c, (counts.get(c) || 0) + 1);
      });
      setStats(Array.from(counts.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count));
      setLoading(false);
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase">რეკომენდირებული კატეგორიები</h3>
        <p className="text-xs text-muted-foreground">
          ეს slug-ები ავტო-შემოთავაზდება ატვირთვის ფორმაში. კატეგორია ცხრილში TEXT ველია — ნებისმიერი მნიშვნელობა მუშაობს.
        </p>
        <div className="flex flex-wrap gap-2">
          {RECOMMENDED.map((c) => (
            <span key={c.slug} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border text-xs">
              <code className="font-mono text-muted-foreground">{c.slug}</code>
              <span>{c.label}</span>
            </span>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase">გამოყენებული კატეგორიები</h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">იტვირთება...</p>
        ) : stats.length === 0 ? (
          <p className="text-xs text-muted-foreground">ჯერ არცერთი დიზაინი არ არის ატვირთული.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left p-2">Category</th>
                  <th className="text-left p-2">Designs</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.category} className="border-t border-border">
                    <td className="p-2 font-mono">{s.category}</td>
                    <td className="p-2">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
