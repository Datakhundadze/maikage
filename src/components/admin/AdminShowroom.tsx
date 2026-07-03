import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";
import { transformedDisplayUrl } from "@/lib/imageTransform";

interface ShowroomPhoto {
  id: string;
  name: string | null;
  photo_path: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // mirrors the showroom-photos bucket file_size_limit
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// `showroom_photos` is schema-ahead-of-types (the table exists on prod but the
// generated Database types lag) — the cast mirrors the (supabase as any)
// convention used in AdminPartners / MyDesignsPage for not-yet-typed objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const photosTable = () => (supabase as any).from("showroom_photos");

const publicUrl = (path: string) =>
  supabase.storage.from("showroom-photos").getPublicUrl(path).data.publicUrl;

export default function AdminShowroom() {
  const [photos, setPhotos] = useState<ShowroomPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchPhotos = useCallback(async (bg = false) => {
    if (!bg) setLoading(true);
    setError(null);
    const { data, error: err } = await photosTable()
      .select("*")
      .order("sort_order", { ascending: true });
    if (err) setError(err.message);
    else setPhotos((data as ShowroomPhoto[]) || []);
    if (!bg) setLoading(false);
  }, []);

  useEffect(() => { fetchPhotos(false); }, [fetchPhotos]);

  // Bulk upload: select many files at once. Each is validated, uploaded to the
  // public showroom-photos bucket, then inserted as a row (name = filename
  // without extension). Promise.allSettled so one failure doesn't block the
  // rest; a failed row insert cleans up its just-uploaded file.
  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const valid = files.filter((f) => f.size <= MAX_BYTES && ALLOWED_MIME.includes(f.type));
    const rejected = files.length - valid.length;
    if (rejected > 0) {
      toast({ title: `${rejected} ფაილი უგულებელყოფილია`, description: "მხოლოდ JPEG/PNG/WEBP ≤ 10MB", variant: "destructive" });
    }
    if (valid.length === 0) { if (fileRef.current) fileRef.current.value = ""; return; }

    setUploading(true);
    const baseOrder = photos.reduce((m, p) => Math.max(m, p.sort_order), 0) + 1;
    const results = await Promise.allSettled(
      valid.map(async (file, idx) => {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("showroom-photos")
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const name = file.name.replace(/\.[^.]+$/, "") || "Photo";
        const { error: insErr } = await photosTable().insert({
          name,
          photo_path: path,
          sort_order: baseOrder + idx,
          active: true,
        });
        if (insErr) {
          await supabase.storage.from("showroom-photos").remove([path]);
          throw insErr;
        }
      }),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (failed > 0) {
      toast({ title: `აიტვირთა ${ok}/${results.length}`, description: "ნაწილი ვერ აიტვირთა", variant: "destructive" });
    } else {
      toast({ title: `დაემატა ${ok} ფოტო ✓` });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    fetchPhotos(true);
  };

  // Optimistic patch (name / active / sort_order). On error, refetch to resync.
  const patch = async (id: string, fields: Partial<Pick<ShowroomPhoto, "name" | "active" | "sort_order">>) => {
    setPhotos((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...fields } : p));
      // Keep the list ordered when sort_order changes.
      return "sort_order" in fields ? [...next].sort((a, b) => a.sort_order - b.sort_order) : next;
    });
    const { error: err } = await photosTable().update(fields).eq("id", id);
    if (err) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      fetchPhotos(true);
    }
  };

  const remove = async (p: ShowroomPhoto) => {
    if (!confirm(`წავშალო "${p.name || "ფოტო"}"?`)) return;
    // Remove the file first so a failed row delete doesn't orphan storage.
    await supabase.storage.from("showroom-photos").remove([p.photo_path]);
    const { error: err } = await photosTable().delete().eq("id", p.id);
    if (err) {
      toast({ title: "წაშლა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      return;
    }
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold">შოურუმის ფოტოები ({photos.length})</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "იტვირთება..." : "ფოტოების ატვირთვა"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchPhotos(false)}>განახლება</Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        აირჩიე ერთი ან რამდენიმე ფაილი ერთდროულად (JPEG/PNG/WEBP, მაქს. 10MB). სახელი ფაილის სახელით ივსება — შემდეგ შეგიძლია შეცვალო. კონტაქტის გვერდზე მხოლოდ აქტიური ფოტოები ჩანს.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchPhotos(false)}>განახლება</Button>
        </div>
      )}

      {photos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">ფოტოები ჯერ არ არის — ატვირთე პირველი.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {photos.map((p) => (
            <div key={p.id} className={`rounded-lg border border-border bg-card p-3 space-y-3 ${p.active ? "" : "opacity-60"}`}>
              <div className="h-40 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                <img src={transformedDisplayUrl(publicUrl(p.photo_path), { width: 400 })} alt={p.name || ""} className="h-full w-full object-cover" loading="lazy" />
              </div>
              <Input
                defaultValue={p.name || ""}
                onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.name || "")) patch(p.id, { name: v }); }}
                className="h-8 text-sm"
                placeholder="სახელი"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  თანმიმდევრობა
                  <Input
                    type="number"
                    defaultValue={p.sort_order}
                    onBlur={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v !== p.sort_order) patch(p.id, { sort_order: v }); }}
                    className="h-8 w-16 text-sm"
                  />
                </label>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" title={p.active ? "გამორთვა" : "ჩართვა"} onClick={() => patch(p.id, { active: !p.active })}>
                    {p.active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="წაშლა" onClick={() => remove(p)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
