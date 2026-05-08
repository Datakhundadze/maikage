import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/categories";
import { Upload } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

interface ProductOption {
  id: string;
  type: string;
  display_name_ka: string;
  display_order: number;
  base_price: number | null;
}

// ALA-LC romanization for Georgian → Latin. Used to seed a URL-safe slug from
// the Georgian title.
const KA_TO_LAT: Record<string, string> = {
  "ა": "a", "ბ": "b", "გ": "g", "დ": "d", "ე": "e", "ვ": "v", "ზ": "z",
  "თ": "t", "ი": "i", "კ": "k", "ლ": "l", "მ": "m", "ნ": "n", "ო": "o",
  "პ": "p", "ჟ": "zh", "რ": "r", "ს": "s", "ტ": "t", "უ": "u", "ფ": "p",
  "ქ": "k", "ღ": "gh", "ყ": "q", "შ": "sh", "ჩ": "ch", "ც": "ts", "ძ": "dz",
  "წ": "ts", "ჭ": "ch", "ხ": "kh", "ჯ": "j", "ჰ": "h",
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugifyTitle(s: string): string {
  let out = "";
  for (const ch of s.toLowerCase()) {
    const mapped = KA_TO_LAT[ch];
    if (mapped) out += mapped;
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s/.test(ch)) out += "-";
    // anything else (punctuation, emoji, ...) is dropped
  }
  return out.replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

// Resize the uploaded print file to a 400x400 thumbnail via canvas. Keeps
// transparency. Returns a Blob ready to upload.
async function makeThumbnail(file: File): Promise<Blob> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const SIZE = 400;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  // Fit (contain) the image into a square thumbnail, transparent background.
  const ratio = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
  const w = img.naturalWidth * ratio;
  const h = img.naturalHeight * ratio;
  ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas toBlob failed"))), "image/png");
  });
}

export default function DesignUploadDialog({ open, onClose, onUploaded }: Props) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);
  const [category, setCategory] = useState<string>("georgian");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [defaultProductId, setDefaultProductId] = useState<string>("");

  // Object URL for the preview frame; revoked when the file changes or unmount.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Auto-suggest the slug from the Georgian title until the admin types into
  // the slug field directly. Then we stop syncing so manual edits stick.
  useEffect(() => {
    if (slugDirty) return;
    setSlug(slugifyTitle(title));
  }, [title, slugDirty]);

  // Load active products for the default-product dropdown. Default to the
  // first T-Shirt so the most common case is one click away.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (supabase as any)
      .from("products")
      .select("id, type, display_name_ka, display_order, base_price")
      .eq("is_active", true)
      .order("type", { ascending: true })
      .order("display_order", { ascending: true })
      .then(({ data }: { data: ProductOption[] | null }) => {
        if (cancelled || !data) return;
        setProducts(data);
        setDefaultProductId((prev) => {
          if (prev) return prev;
          const firstTshirt = data.find((p) => p.type === "T-Shirt");
          return firstTshirt?.id ?? data[0]?.id ?? "";
        });
      });
    return () => { cancelled = true; };
  }, [open]);

  // Slug uniqueness probe (best-effort; final check happens at insert time
  // via the unique constraint).
  useEffect(() => {
    if (!slug || !SLUG_RE.test(slug)) { setSlugTaken(false); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      (supabase as any)
        .from("catalog_designs")
        .select("slug")
        .eq("slug", slug)
        .limit(1)
        .then(({ data }: { data: { slug: string }[] | null }) => {
          if (!cancelled) setSlugTaken((data?.length ?? 0) > 0);
        });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [slug]);

  const productsByType = useMemo(() => {
    const groups: Record<string, ProductOption[]> = {};
    for (const p of products) {
      (groups[p.type] ||= []).push(p);
    }
    return groups;
  }, [products]);

  const reset = () => {
    setTitle(""); setTitleEn(""); setSlug(""); setSlugDirty(false); setSlugTaken(false);
    setCategory("georgian"); setTags(""); setDescription(""); setFile(null);
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast({ title: "შეიყვანე სათაური", variant: "destructive" }); return; }
    if (!slug || !SLUG_RE.test(slug) || slug.length < 3 || slug.length > 60) {
      toast({ title: "Slug არასწორია", description: "მხოლოდ a-z, 0-9, dash; 3-60 სიმბოლო", variant: "destructive" });
      return;
    }
    if (!defaultProductId) { toast({ title: "აირჩიე ნაგულისხმევი პროდუქტი", variant: "destructive" }); return; }
    if (!file) { toast({ title: "აირჩიე print file", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";

      // 1. upload print file
      const printPath = `prints/${slug}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("catalog-designs")
        .upload(printPath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl: printUrl } } = supabase.storage
        .from("catalog-designs")
        .getPublicUrl(printPath);

      // 2. generate + upload thumbnail
      let thumbUrl: string | null = null;
      try {
        const thumbBlob = await makeThumbnail(file);
        const thumbPath = `thumbnails/${slug}-${Date.now()}.png`;
        const { error: thErr } = await supabase.storage
          .from("catalog-designs")
          .upload(thumbPath, thumbBlob, { contentType: "image/png", upsert: false });
        if (!thErr) {
          const { data: { publicUrl } } = supabase.storage.from("catalog-designs").getPublicUrl(thumbPath);
          thumbUrl = publicUrl;
        }
      } catch (e) {
        console.warn("[DesignUpload] thumbnail generation failed:", e);
      }

      // 3. insert row
      const { error: insErr } = await (supabase as any).from("catalog_designs").insert({
        slug,
        title_ka: title.trim(),
        title_en: titleEn.trim() || null,
        description_ka: description.trim() || null,
        category: category || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        print_file_url: printUrl,
        thumbnail_url: thumbUrl,
        default_product_id: defaultProductId,
        is_published: false,
      });
      if (insErr) throw insErr;

      toast({ title: "ატვირთულია", description: `${title} (slug: ${slug})` });
      reset();
      onUploaded();
    } catch (err: any) {
      toast({ title: "შეცდომა", description: err.message ?? String(err), variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ახალი დიზაინი</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-title">სათაური *</Label>
            <Input id="cat-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="მაგ. ქართული ნაკრები" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-slug">სლაგი *</Label>
            <Input
              id="cat-slug"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugDirty(true); }}
              placeholder="kartuli-nakreba"
            />
            <p className="text-xs text-muted-foreground">URL: maika.ge/design/<code>{slug || "..."}</code></p>
            {slug && !SLUG_RE.test(slug) && (
              <p className="text-xs text-destructive">მხოლოდ a-z, 0-9, dash; პირველი/ბოლო სიმბოლო ასო ან ციფრი</p>
            )}
            {slug && SLUG_RE.test(slug) && slugTaken && (
              <p className="text-xs text-amber-600">⚠ ეს slug უკვე გამოყენებულია — შეცვალე სხვაზე</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-title-en">სათაური (EN)</Label>
            <Input id="cat-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="optional" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-default-product">ნაგულისხმევი პროდუქტი *</Label>
            <select
              id="cat-default-product"
              value={defaultProductId}
              onChange={(e) => setDefaultProductId(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {products.length === 0 && <option value="">იტვირთება...</option>}
              {Object.entries(productsByType).map(([type, items]) => (
                <optgroup key={type} label={type}>
                  {items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name_ka}{p.base_price != null ? ` — ₾${p.base_price}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">კატალოგში თავდაპირველად ამ პროდუქტზე გამოჩნდება</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-category">კატეგორია *</Label>
            <select
              id="cat-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c.slug} value={c.slug}>{c.label_ka}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-tags">ტეგები (მძიმეებით)</Label>
            <Input id="cat-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="football, georgia" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">აღწერა</Label>
            <Textarea id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-file">Print file (4000×4800 transparent PNG) *</Label>
            <Input id="cat-file" type="file" accept="image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} — {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
            {previewUrl && (
              <div
                className="mt-2 mx-auto w-full max-w-[400px] aspect-square rounded-md border border-border overflow-hidden"
                style={{
                  backgroundImage:
                    "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)",
                  backgroundSize: "20px 20px",
                  backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0",
                }}
              >
                <img src={previewUrl} alt="preview" className="w-full h-full object-contain" />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>გაუქმება</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            <Upload className="h-4 w-4 mr-1" />
            {submitting ? "იტვირთება..." : "ატვირთვა"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
