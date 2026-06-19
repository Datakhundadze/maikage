import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Upload, Trash2, Eye, EyeOff, Loader2 } from "lucide-react";

interface Partner {
  id: string;
  name: string;
  logo_path: string;
  sort_order: number;
  active: boolean;
  created_at: string;
}

const MAX_BYTES = 5 * 1024 * 1024; // mirrors the partner-logos bucket file_size_limit
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// `partners` is schema-ahead-of-types (the table exists on prod but the
// generated Database types lag) — the cast mirrors the (supabase as any)
// convention used in MyDesignsPage / admin for not-yet-typed objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const partnersTable = () => (supabase as any).from("partners");

const publicUrl = (path: string) =>
  supabase.storage.from("partner-logos").getPublicUrl(path).data.publicUrl;

export default function AdminPartners() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchPartners = useCallback(async (bg = false) => {
    if (!bg) setLoading(true);
    setError(null);
    const { data, error: err } = await partnersTable()
      .select("*")
      .order("sort_order", { ascending: true });
    if (err) setError(err.message);
    else setPartners((data as Partner[]) || []);
    if (!bg) setLoading(false);
  }, []);

  useEffect(() => { fetchPartners(false); }, [fetchPartners]);

  // Bulk upload: select many files at once. Each is validated, uploaded to the
  // public partner-logos bucket, then inserted as a row (name = filename
  // without extension). Promise.allSettled so one failure doesn't block the
  // rest; a failed row insert cleans up its just-uploaded file.
  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const valid = files.filter((f) => f.size <= MAX_BYTES && ALLOWED_MIME.includes(f.type));
    const rejected = files.length - valid.length;
    if (rejected > 0) {
      toast({ title: `${rejected} ფაილი უგულებელყოფილია`, description: "მხოლოდ PNG/JPEG/WEBP/SVG ≤ 5MB", variant: "destructive" });
    }
    if (valid.length === 0) { if (fileRef.current) fileRef.current.value = ""; return; }

    setUploading(true);
    const baseOrder = partners.reduce((m, p) => Math.max(m, p.sort_order), 0) + 1;
    const results = await Promise.allSettled(
      valid.map(async (file, idx) => {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("partner-logos")
          .upload(path, file, { contentType: file.type });
        if (upErr) throw upErr;
        const name = file.name.replace(/\.[^.]+$/, "") || "Partner";
        const { error: insErr } = await partnersTable().insert({
          name,
          logo_path: path,
          sort_order: baseOrder + idx,
          active: true,
        });
        if (insErr) {
          await supabase.storage.from("partner-logos").remove([path]);
          throw insErr;
        }
      }),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    if (failed > 0) {
      toast({ title: `აიტვირთა ${ok}/${results.length}`, description: "ნაწილი ვერ აიტვირთა", variant: "destructive" });
    } else {
      toast({ title: `დაემატა ${ok} ლოგო ✓` });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    fetchPartners(true);
  };

  // Optimistic patch (name / active / sort_order). On error, refetch to resync.
  const patch = async (id: string, fields: Partial<Pick<Partner, "name" | "active" | "sort_order">>) => {
    setPartners((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...fields } : p));
      // Keep the list ordered when sort_order changes.
      return "sort_order" in fields ? [...next].sort((a, b) => a.sort_order - b.sort_order) : next;
    });
    const { error: err } = await partnersTable().update(fields).eq("id", id);
    if (err) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      fetchPartners(true);
    }
  };

  const remove = async (p: Partner) => {
    if (!confirm(`წავშალო "${p.name}"?`)) return;
    // Remove the file first so a failed row delete doesn't orphan storage.
    await supabase.storage.from("partner-logos").remove([p.logo_path]);
    const { error: err } = await partnersTable().delete().eq("id", p.id);
    if (err) {
      toast({ title: "წაშლა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      return;
    }
    setPartners((prev) => prev.filter((x) => x.id !== p.id));
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
        <h2 className="text-lg font-semibold">პარტნიორების ლოგოები ({partners.length})</h2>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "იტვირთება..." : "ლოგოების ატვირთვა"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchPartners(false)}>განახლება</Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        აირჩიე ერთი ან რამდენიმე ფაილი ერთდროულად (PNG/JPEG/WEBP/SVG, მაქს. 5MB). სახელი ფაილის სახელით ივსება — შემდეგ შეგიძლია შეცვალო. მარკიზაში მხოლოდ აქტიური ლოგოები ჩანს.
      </p>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => fetchPartners(false)}>განახლება</Button>
        </div>
      )}

      {partners.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">ლოგოები ჯერ არ არის — ატვირთე პირველი.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {partners.map((p) => (
            <div key={p.id} className={`rounded-lg border border-border bg-card p-3 space-y-3 ${p.active ? "" : "opacity-60"}`}>
              {/* White tile so transparent/dark logos read clearly in admin */}
              <div className="h-20 rounded-md bg-white flex items-center justify-center overflow-hidden p-2">
                <img src={publicUrl(p.logo_path)} alt={p.name} className="max-h-full w-auto object-contain" loading="lazy" />
              </div>
              <Input
                defaultValue={p.name}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) patch(p.id, { name: v }); }}
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
