import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Pencil } from "lucide-react";

interface Product {
  id: string;
  slug: string;
  type: string;
  sub_product: string | null;
  display_name_ka: string;
  display_name_en: string | null;
  base_price: number | null;
  print_area_x: number;
  print_area_y: number;
  print_area_width: number;
  print_area_height: number;
  colors: { name: string; hex: string; mockup_url?: string; is_default?: boolean }[];
  sizes: string[];
  is_active: boolean;
  display_order: number;
}

export default function CatalogProducts() {
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("products")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) {
      toast({ title: "შეცდომა", description: error.message, variant: "destructive" });
    } else {
      setProducts((data || []) as Product[]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    products.forEach((p) => {
      const arr = map.get(p.type) || [];
      arr.push(p);
      map.set(p.type, arr);
    });
    return Array.from(map.entries());
  }, [products]);

  if (loading) return <p className="text-sm text-muted-foreground">იტვირთება...</p>;
  if (products.length === 0) return (
    <p className="text-sm text-muted-foreground py-8 text-center">
      პროდუქტები არ არის — გაუშვი migration რომ catalog.ts-ის snapshot ჩაიწეროს DB-ში.
    </p>
  );

  return (
    <div className="space-y-6">
      {grouped.map(([type, items]) => (
        <div key={type} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase">{type} ({items.length})</h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs">
                <tr>
                  <th className="text-left p-2">Brand</th>
                  <th className="text-left p-2">სახელი</th>
                  <th className="text-left p-2">ფასი</th>
                  <th className="text-left p-2">ფერები</th>
                  <th className="text-left p-2">ზომები</th>
                  <th className="text-left p-2">სტატუსი</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} className="border-t border-border hover:bg-accent/30">
                    <td className="p-2 font-mono text-xs">{p.sub_product || "—"}</td>
                    <td className="p-2">{p.display_name_ka}</td>
                    <td className="p-2">{p.base_price != null ? `${p.base_price} ₾` : <span className="text-muted-foreground">—</span>}</td>
                    <td className="p-2">
                      <div className="flex gap-0.5 flex-wrap">
                        {p.colors.slice(0, 8).map((c) => (
                          <span key={c.name} className="h-3 w-3 rounded-sm border border-border" style={{ backgroundColor: c.hex }} title={c.name} />
                        ))}
                        {p.colors.length > 8 && <span className="text-xs text-muted-foreground">+{p.colors.length - 8}</span>}
                      </div>
                    </td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {p.sizes.length === 0 ? "—" : p.sizes.length > 4 ? `${p.sizes.length} ზომა` : p.sizes.join(", ")}
                    </td>
                    <td className="p-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${p.is_active ? "bg-green-500/15 text-green-500" : "bg-muted text-muted-foreground"}`}>
                        {p.is_active ? "active" : "off"}
                      </span>
                    </td>
                    <td className="p-2">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editing && (
        <ProductEditDialog
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

interface EditProps {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}

function ProductEditDialog({ product, onClose, onSaved }: EditProps) {
  const { toast } = useToast();
  const [name, setName] = useState(product.display_name_ka);
  const [price, setPrice] = useState(product.base_price?.toString() ?? "");
  const [sizes, setSizes] = useState(product.sizes.join(", "));
  const [colorsJson, setColorsJson] = useState(JSON.stringify(product.colors, null, 2));
  const [printAreaX, setPrintAreaX] = useState(product.print_area_x.toString());
  const [printAreaY, setPrintAreaY] = useState(product.print_area_y.toString());
  const [printAreaW, setPrintAreaW] = useState(product.print_area_width.toString());
  const [printAreaH, setPrintAreaH] = useState(product.print_area_height.toString());
  const [active, setActive] = useState(product.is_active);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    setSubmitting(true);
    try {
      let parsedColors: unknown;
      try { parsedColors = JSON.parse(colorsJson); }
      catch { throw new Error("colors JSON არასწორია"); }
      if (!Array.isArray(parsedColors)) throw new Error("colors უნდა იყოს array");

      const priceNum = price.trim() === "" ? null : Number(price);
      if (priceNum != null && Number.isNaN(priceNum)) throw new Error("ფასი არასწორია");

      const update = {
        display_name_ka: name.trim(),
        base_price: priceNum,
        sizes: sizes.split(",").map((s) => s.trim()).filter(Boolean),
        colors: parsedColors,
        print_area_x: Number(printAreaX),
        print_area_y: Number(printAreaY),
        print_area_width: Number(printAreaW),
        print_area_height: Number(printAreaH),
        is_active: active,
      };
      const { error } = await (supabase as any).from("products").update(update).eq("id", product.id);
      if (error) throw error;
      toast({ title: "შენახულია" });
      onSaved();
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message ?? String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product.type} {product.sub_product ? `— ${product.sub_product}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>სახელი (KA)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>ფასი (₾)</Label>
            <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="35" />
          </div>
          <div className="space-y-1.5">
            <Label>ზომები (მძიმეებით)</Label>
            <Input value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="S, M, L, XL, XXL" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Print X (%)</Label>
              <Input value={printAreaX} onChange={(e) => setPrintAreaX(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Print Y (%)</Label>
              <Input value={printAreaY} onChange={(e) => setPrintAreaY(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Print W (%)</Label>
              <Input value={printAreaW} onChange={(e) => setPrintAreaW(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Print H (%)</Label>
              <Input value={printAreaH} onChange={(e) => setPrintAreaH(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>ფერები (JSON: name/hex/mockup_url/is_default)</Label>
            <textarea
              value={colorsJson}
              onChange={(e) => setColorsJson(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            აქტიური (ხილული საიტზე)
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>გაუქმება</Button>
          <Button onClick={save} disabled={submitting}>{submitting ? "ინახება..." : "შენახვა"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
