import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Upload } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const DEFAULT_CATEGORIES = [
  "georgian", "sports", "humor", "anime", "food", "gym", "tech", "seasonal",
];

// Auto-slug from title (UTF-8 friendly: lowercase ASCII + dashes; for Georgian
// titles strip non-letters and append timestamp so we always get something).
function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `design-${Date.now().toString(36)}`;
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
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(""); setTitleEn(""); setCategory(""); setTags(""); setDescription(""); setFile(null);
  };

  const handleSubmit = async () => {
    if (!title.trim()) { toast({ title: "შეიყვანე სათაური", variant: "destructive" }); return; }
    if (!file) { toast({ title: "აირჩიე print file", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const slug = slugify(title);
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
        category: category.trim() || null,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        print_file_url: printUrl,
        thumbnail_url: thumbUrl,
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>ახალი დიზაინი</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cat-title">სათაური *</Label>
            <Input id="cat-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="მაგ. ქართული ნაკრები" />
            {title && <p className="text-xs text-muted-foreground">slug: <code>{slugify(title)}</code></p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-title-en">სათაური (EN)</Label>
            <Input id="cat-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} placeholder="optional" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cat-category">კატეგორია</Label>
            <Input
              id="cat-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="georgian, sports, humor..."
              list="cat-suggestions"
            />
            <datalist id="cat-suggestions">
              {DEFAULT_CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
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
