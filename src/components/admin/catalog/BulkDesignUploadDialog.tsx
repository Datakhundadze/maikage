import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES } from "@/lib/categories";
import { Upload, X, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { slugifyTitle, makeThumbnail, SLUG_RE } from "./designUploadHelpers";

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

type RowStatus = "pending" | "uploading" | "done" | "error";

interface BulkRow {
  id: string;
  file: File;
  previewUrl: string;
  titleKa: string;
  titleEn: string;
  category: string;
  defaultProductId: string;
  tags: string;
  slug: string;
  slugDirty: boolean;
  status: RowStatus;
  error?: string;
}

const MAX_FILES = 20;
const CONCURRENCY = 3;

// Run worker on items up to `concurrency` at a time. Resolves once every
// item has finished — failures inside worker are the caller's responsibility
// to surface (we don't reject the pool on a single failure).
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        await worker(items[i], i);
      }
    },
  );
  await Promise.all(runners);
}

export default function BulkDesignUploadDialog({ open, onClose, onUploaded }: Props) {
  const { toast } = useToast();
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load products once when the dialog opens — same shape and ordering as
  // the single-upload dialog so admins see identical dropdowns in both.
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
        if (!cancelled && data) setProducts(data);
      });
    return () => { cancelled = true; };
  }, [open]);

  // Revoke object URLs when this component closes / unmounts so the browser
  // can release the in-memory File blobs. We track this in a ref so the
  // effect doesn't fight per-row state mutations.
  const objectUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  }, []);

  const productsByType = useMemo(() => {
    const groups: Record<string, ProductOption[]> = {};
    for (const p of products) {
      (groups[p.type] ||= []).push(p);
    }
    return groups;
  }, [products]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    setRows((prev) => {
      const remainingSlots = MAX_FILES - prev.length;
      if (remainingSlots <= 0) {
        toast({
          title: "ლიმიტი მიღწეულია",
          description: `მაქს. ${MAX_FILES} ფაილი ერთ ჯერზე.`,
          variant: "destructive",
        });
        return prev;
      }
      const toAdd = incoming.slice(0, remainingSlots);
      if (incoming.length > remainingSlots) {
        toast({
          title: "ნაწილი გამოტოვდა",
          description: `${incoming.length - remainingSlots} ფაილი ლიმიტს ცილდება — გამოტოვებულია.`,
        });
      }
      const newRows: BulkRow[] = toAdd.map((file) => {
        const url = URL.createObjectURL(file);
        objectUrlsRef.current.push(url);
        const baseName = file.name.replace(/\.[^.]+$/, "");
        const initialTitle = baseName.replace(/[-_]+/g, " ").trim();
        return {
          id: crypto.randomUUID(),
          file,
          previewUrl: url,
          titleKa: initialTitle,
          titleEn: "",
          category: CATEGORIES[0].slug,
          defaultProductId: "",
          tags: "",
          slug: slugifyTitle(initialTitle),
          slugDirty: false,
          status: "pending",
        };
      });
      return [...prev, ...newRows];
    });
  }, [toast]);

  const updateRow = useCallback((id: string, patch: Partial<BulkRow>) => {
    setRows((prev) => prev.map((r) => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      // Auto-sync slug from titleKa until the admin types directly into the
      // slug field — same UX as the single-upload dialog.
      if (patch.titleKa !== undefined && !r.slugDirty) {
        next.slug = slugifyTitle(patch.titleKa);
      }
      if (patch.slug !== undefined) {
        next.slugDirty = true;
      }
      return next;
    }));
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const handleClose = () => {
    if (submitting) return;
    rows.forEach((r) => URL.revokeObjectURL(r.previewUrl));
    setRows([]);
    setCompleted(0);
    onClose();
  };

  // Validate one row up-front. Bad rows are skipped at submit time (the row
  // surfaces the reason inline). We don't block the entire batch on a single
  // bad row — the admin can drop a 20-file batch and fix the 1-2 stragglers
  // without re-uploading the rest.
  const rowError = (r: BulkRow): string | null => {
    if (!r.titleKa.trim()) return "სათაური აუცილებელია";
    if (!r.slug || !SLUG_RE.test(r.slug) || r.slug.length < 3 || r.slug.length > 60) {
      return "slug არასწორია (a-z, 0-9, dash; 3-60 სიმბ.)";
    }
    if (!r.defaultProductId) return "აირჩიე ნაგულისხმევი პროდუქტი";
    return null;
  };

  const uploadOne = async (row: BulkRow): Promise<void> => {
    const ext = row.file.name.split(".").pop()?.toLowerCase() || "png";
    const ts = Date.now();

    const printPath = `prints/${row.slug}-${ts}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("catalog-designs")
      .upload(printPath, row.file, { contentType: row.file.type, upsert: false });
    if (upErr) throw upErr;
    const { data: { publicUrl: printUrl } } = supabase.storage
      .from("catalog-designs")
      .getPublicUrl(printPath);

    let thumbUrl: string | null = null;
    try {
      const thumbBlob = await makeThumbnail(row.file);
      const thumbPath = `thumbnails/${row.slug}-${ts}.png`;
      const { error: thErr } = await supabase.storage
        .from("catalog-designs")
        .upload(thumbPath, thumbBlob, { contentType: "image/png", upsert: false });
      if (!thErr) {
        const { data: { publicUrl } } = supabase.storage
          .from("catalog-designs")
          .getPublicUrl(thumbPath);
        thumbUrl = publicUrl;
      }
    } catch (e) {
      console.warn("[BulkUpload] thumbnail generation failed for", row.file.name, e);
    }

    const { error: insErr } = await (supabase as any)
      .from("catalog_designs")
      .insert({
        slug: row.slug,
        title_ka: row.titleKa.trim(),
        title_en: row.titleEn.trim() || null,
        description_ka: null,
        category: row.category || null,
        tags: row.tags.split(",").map((t) => t.trim()).filter(Boolean),
        print_file_url: printUrl,
        thumbnail_url: thumbUrl,
        default_product_id: row.defaultProductId,
        is_published: false,
      });
    if (insErr) throw insErr;
  };

  const handleSubmit = async () => {
    if (rows.length === 0) {
      toast({ title: "ცარიელია", description: "ჯერ ჩააგდე ფაილები.", variant: "destructive" });
      return;
    }
    // Mark invalid rows up-front with their error so the admin can fix
    // them without losing the queue.
    let invalidCount = 0;
    setRows((prev) => prev.map((r) => {
      if (r.status === "done") return r;
      const err = rowError(r);
      if (err) {
        invalidCount++;
        return { ...r, status: "error", error: err };
      }
      return { ...r, status: "pending", error: undefined };
    }));
    // Re-read state after the setRows above by computing eligible rows from
    // the current closure value. (setRows is async; we filter from `rows`
    // and rely on the same validation logic.)
    const eligible = rows.filter((r) => r.status !== "done" && rowError(r) === null);
    if (eligible.length === 0) {
      toast({
        title: "ვერც ერთი მზად არ არის",
        description: `${invalidCount} რიგი არასრულია — შეასწორე.`,
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    setCompleted(0);

    let successCount = 0;
    let failCount = 0;

    await runWithConcurrency(eligible, CONCURRENCY, async (row) => {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "uploading", error: undefined } : r)));
      try {
        await uploadOne(row);
        successCount++;
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "done", error: undefined } : r)));
      } catch (err: any) {
        failCount++;
        const msg = err?.message ?? String(err);
        setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: "error", error: msg } : r)));
      } finally {
        setCompleted((c) => c + 1);
      }
    });

    setSubmitting(false);

    if (successCount > 0) {
      toast({ title: `${successCount} დიზაინი წარმატებით აიტვირთა (Draft)` });
      onUploaded();
    }
    if (failCount > 0) {
      toast({
        title: `${failCount} დიზაინი ვერ აიტვირთა — გადახედე`,
        variant: "destructive",
      });
    }
  };

  const totalEligible = useMemo(
    () => rows.filter((r) => r.status === "pending" || r.status === "uploading").length,
    [rows],
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (submitting) return;
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent
        className="max-w-6xl w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => { if (submitting) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (submitting) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>ჯგუფური ატვირთვა — დიზაინები</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              isDragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            } ${submitting ? "opacity-50 pointer-events-none" : ""}`}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">ჩააგდე 1-{MAX_FILES} PNG ფაილი აქ ან დააწექი ასარჩევად</p>
            <p className="text-xs text-muted-foreground mt-1">
              {rows.length === 0 ? "ცარიელია" : `${rows.length} / ${MAX_FILES} რიგი`}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left p-2 w-16">პრევიუ</th>
                    <th className="text-left p-2 w-32 hidden xl:table-cell">ფაილი</th>
                    <th className="text-left p-2">სათაური KA *</th>
                    <th className="text-left p-2 hidden lg:table-cell">სათაური EN</th>
                    <th className="text-left p-2">კატეგორია</th>
                    <th className="text-left p-2">პროდუქტი *</th>
                    <th className="text-left p-2 hidden lg:table-cell">slug</th>
                    <th className="text-left p-2 hidden xl:table-cell">ტეგები</th>
                    <th className="text-left p-2 w-24">სტატუსი</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={`border-b border-border/50 align-top ${r.status === "error" ? "bg-destructive/5" : r.status === "done" ? "bg-green-500/5" : ""}`}>
                      <td className="p-2">
                        <div
                          className="w-12 h-12 rounded border border-border overflow-hidden bg-muted/30"
                          style={{
                            backgroundImage:
                              "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)",
                            backgroundSize: "8px 8px",
                            backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0",
                          }}
                        >
                          <img src={r.previewUrl} alt={r.file.name} className="w-full h-full object-contain" />
                        </div>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground hidden xl:table-cell truncate max-w-[10rem]" title={r.file.name}>
                        {r.file.name}
                      </td>
                      <td className="p-2">
                        <Input
                          value={r.titleKa}
                          onChange={(e) => updateRow(r.id, { titleKa: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="h-8 text-sm"
                          placeholder="ქართული ნაკრები"
                        />
                      </td>
                      <td className="p-2 hidden lg:table-cell">
                        <Input
                          value={r.titleEn}
                          onChange={(e) => updateRow(r.id, { titleEn: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="h-8 text-sm"
                          placeholder="optional"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={r.category}
                          onChange={(e) => updateRow(r.id, { category: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c.slug} value={c.slug}>{c.label_ka}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          value={r.defaultProductId}
                          onChange={(e) => updateRow(r.id, { defaultProductId: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">-- აირჩიე --</option>
                          {Object.entries(productsByType).map(([type, items]) => (
                            <optgroup key={type} label={type}>
                              {items.map((p) => (
                                <option key={p.id} value={p.id}>{p.display_name_ka}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 hidden lg:table-cell">
                        <Input
                          value={r.slug}
                          onChange={(e) => updateRow(r.id, { slug: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="h-8 text-sm font-mono"
                          placeholder="kartuli-nakreba"
                        />
                      </td>
                      <td className="p-2 hidden xl:table-cell">
                        <Input
                          value={r.tags}
                          onChange={(e) => updateRow(r.id, { tags: e.target.value })}
                          disabled={submitting && r.status !== "error"}
                          className="h-8 text-sm"
                          placeholder="tag1, tag2"
                        />
                      </td>
                      <td className="p-2">
                        {r.status === "pending" && <span className="text-xs text-muted-foreground">მზად</span>}
                        {r.status === "uploading" && (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" /> იტვირთება
                          </span>
                        )}
                        {r.status === "done" && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-500">
                            <CheckCircle2 className="h-3 w-3" /> Draft
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="inline-flex items-start gap-1 text-xs text-destructive" title={r.error}>
                            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                            <span className="line-clamp-2">{r.error}</span>
                          </span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <button
                          onClick={() => removeRow(r.id)}
                          disabled={submitting && r.status === "uploading"}
                          className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-destructive disabled:opacity-30"
                          title="წაშლა"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {submitting && rows.length > 0 && (
          <div className="px-1 py-2 border-t border-border">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">ატვირთვა: {completed} / {totalEligible || rows.length}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(completed / Math.max(1, totalEligible || rows.length)) * 100}%` }}
              />
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border pt-3">
          <div className="flex-1 text-xs text-muted-foreground hidden sm:block">
            ყველა ფაილი მონიშნულია Draft-ად — გამოქვეყნება ცალკე ღილაკით.
          </div>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            გაუქმება
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || rows.length === 0}>
            <Upload className="h-4 w-4 mr-1" />
            {submitting ? "იტვირთება..." : `შენახვა Draft-ად (${rows.filter((r) => r.status !== "done").length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
