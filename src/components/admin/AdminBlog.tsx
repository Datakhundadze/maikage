import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { ArrowLeft, Eye, EyeOff, ImagePlus, Newspaper, Plus, Trash2, Upload } from "lucide-react";
import MarkdownView from "@/components/MarkdownView";
import { transformedDisplayUrl } from "@/lib/imageTransform";
import { slugifyTitle, SLUG_RE } from "@/components/admin/catalog/designUploadHelpers";

// Blog CMS tab — mirrors the AdminPortfolio pattern (public bucket 'blog' +
// blog_posts table, admin-gated writes). Articles are MARKDOWN (body_md),
// previewed live with the SAME MarkdownView the public /blog/:slug page uses,
// so what the admin sees is what ships. YouTube: paste the video URL on its
// own line. Inline images: the button uploads to the bucket and inserts the
// markdown at the cursor.

interface BlogPost {
  id: string;
  slug: string;
  title_ka: string;
  body_md: string;
  cover_path: string | null;
  meta_description_ka: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // mirrors the blog bucket file_size_limit
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];

// blog_posts is schema-ahead-of-types — cast mirrors the other admin tabs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const postsTable = () => (supabase as any).from("blog_posts");

const publicUrl = (path: string) =>
  supabase.storage.from("blog").getPublicUrl(path).data.publicUrl;

// Blank editor state for a new article.
const EMPTY: Omit<BlogPost, "id" | "created_at" | "published_at"> = {
  slug: "",
  title_ka: "",
  body_md: "",
  cover_path: null,
  meta_description_ka: null,
  published: false,
};

export default function AdminBlog() {
  const { toast } = useToast();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state — null means "list view". `editingId` null = creating new.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);
  const [metaDescription, setMetaDescription] = useState("");
  const [body, setBody] = useState("");
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const coverInputRef = useRef<HTMLInputElement>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const fetchPosts = useCallback(async (bg = false) => {
    if (!bg) setLoading(true);
    setError(null);
    const { data, error: err } = await postsTable()
      .select("*")
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setPosts((data as BlogPost[]) || []);
    if (!bg) setLoading(false);
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  // Auto-suggest the slug from the title until the admin edits it directly
  // (mirrors DesignUploadDialog).
  useEffect(() => {
    if (slugDirty) return;
    setSlug(slugifyTitle(title));
  }, [title, slugDirty]);

  // Slug uniqueness probe (excluding the post being edited).
  useEffect(() => {
    if (!slug || !SLUG_RE.test(slug)) { setSlugTaken(false); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await postsTable().select("id, slug").eq("slug", slug).limit(1);
      if (cancelled) return;
      const hit = (data as { id: string }[] | null)?.[0];
      setSlugTaken(!!hit && hit.id !== editingId);
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [slug, editingId]);

  const openEditor = (post: BlogPost | null) => {
    setEditingId(post?.id ?? null);
    setTitle(post?.title_ka ?? EMPTY.title_ka);
    setSlug(post?.slug ?? EMPTY.slug);
    setSlugDirty(!!post); // editing an existing post never auto-rewrites its slug
    setMetaDescription(post?.meta_description_ka ?? "");
    setBody(post?.body_md ?? "");
    setCoverPath(post?.cover_path ?? null);
    setEditorOpen(true);
  };

  const uploadImage = async (file: File, prefix: string): Promise<string | null> => {
    if (file.size > MAX_BYTES || !ALLOWED_MIME.includes(file.type)) {
      toast({ title: "ფაილი უგულებელყოფილია", description: "მხოლოდ JPEG/PNG/WEBP ≤ 10MB", variant: "destructive" });
      return null;
    }
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${prefix}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("blog").upload(path, file, { contentType: file.type });
    if (upErr) {
      toast({ title: "ატვირთვა ვერ მოხერხდა", description: upErr.message, variant: "destructive" });
      return null;
    }
    return path;
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const path = await uploadImage(file, "covers");
    if (path) setCoverPath(path);
  };

  // Inline image: upload → insert markdown at the textarea cursor.
  const handleInlineImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingImage(true);
    const path = await uploadImage(file, "inline");
    setUploadingImage(false);
    if (!path) return;
    const md = `\n![](${publicUrl(path)})\n`;
    const el = bodyRef.current;
    const pos = el ? el.selectionStart : body.length;
    setBody((prev) => prev.slice(0, pos) + md + prev.slice(pos));
  };

  const canSave =
    title.trim().length > 0 &&
    SLUG_RE.test(slug) && slug.length >= 3 && slug.length <= 60 &&
    !slugTaken && !saving;

  const save = async (publish?: boolean) => {
    if (!canSave) return;
    setSaving(true);
    const current = posts.find((p) => p.id === editingId);
    const willPublish = publish ?? current?.published ?? false;
    const fields = {
      slug,
      title_ka: title.trim(),
      body_md: body,
      cover_path: coverPath,
      meta_description_ka: metaDescription.trim() || null,
      published: willPublish,
      // Stamp published_at on the first publish only.
      published_at: willPublish ? (current?.published_at ?? new Date().toISOString()) : current?.published_at ?? null,
    };
    const { error: err } = editingId
      ? await postsTable().update(fields).eq("id", editingId)
      : await postsTable().insert(fields);
    setSaving(false);
    if (err) {
      toast({ title: "შენახვა ვერ მოხერხდა", description: err.message, variant: "destructive" });
      return;
    }
    toast({ title: willPublish ? "გამოქვეყნდა ✓" : "შენახულია ✓" });
    setEditorOpen(false);
    fetchPosts(true);
  };

  const togglePublished = async (post: BlogPost) => {
    const { error: err } = await postsTable()
      .update({
        published: !post.published,
        published_at: !post.published ? (post.published_at ?? new Date().toISOString()) : post.published_at,
      })
      .eq("id", post.id);
    if (err) toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
    else fetchPosts(true);
  };

  const remove = async (post: BlogPost) => {
    if (!confirm(`წავშალო "${post.title_ka}"?`)) return;
    if (post.cover_path) await supabase.storage.from("blog").remove([post.cover_path]);
    const { error: err } = await postsTable().delete().eq("id", post.id);
    if (err) toast({ title: "წაშლა ვერ მოხერხდა", description: err.message, variant: "destructive" });
    else { toast({ title: "წაიშალა ✓" }); fetchPosts(true); }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // ── Editor view ─────────────────────────────────────────────────────────
  if (editorOpen) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(false)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> სია
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={!canSave} onClick={() => save(false)}>
              {saving ? "ინახება..." : "შენახვა (დრაფტი)"}
            </Button>
            <Button size="sm" disabled={!canSave} onClick={() => save(true)}>
              {saving ? "..." : "გამოქვეყნება"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Form column */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">სათაური *</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="მაგ. Nike ივენთი დინამოს არენაზე" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">სლაგი *</label>
              <Input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugDirty(true); }} placeholder="nike-eventi" />
              <p className="text-xs text-muted-foreground">URL: maika.ge/blog/<code>{slug || "..."}</code></p>
              {slug && !SLUG_RE.test(slug) && (
                <p className="text-xs text-destructive">მხოლოდ a-z, 0-9, dash; 3-60 სიმბოლო</p>
              )}
              {slugTaken && <p className="text-xs text-amber-600">⚠ ეს slug უკვე გამოყენებულია</p>}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Meta description (SEO, ~150 სიმბოლო)</label>
              <Textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={2} maxLength={200} />
            </div>

            {/* Cover */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">ქავერი</label>
              <input ref={coverInputRef} type="file" accept="image/*" className="hidden" onChange={handleCoverUpload} />
              {coverPath ? (
                <div className="space-y-2">
                  <img
                    src={transformedDisplayUrl(publicUrl(coverPath), { width: 600 })}
                    alt="cover"
                    className="w-full max-w-sm rounded-lg border border-border"
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => coverInputRef.current?.click()}>შეცვლა</Button>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCoverPath(null)}>მოხსნა</Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="w-full h-16 border-dashed gap-2" onClick={() => coverInputRef.current?.click()}>
                  <Upload className="h-4 w-4" /> ატვირთე ქავერი
                </Button>
              )}
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">ტექსტი (Markdown)</label>
                <input ref={inlineInputRef} type="file" accept="image/*" className="hidden" onChange={handleInlineImageUpload} />
                <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" disabled={uploadingImage} onClick={() => inlineInputRef.current?.click()}>
                  <ImagePlus className="h-3.5 w-3.5" /> {uploadingImage ? "იტვირთება..." : "ფოტოს ჩასმა"}
                </Button>
              </div>
              <Textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                className="font-mono text-sm"
                placeholder={"## სათაური\n\nტექსტი **მუქი** და სია:\n\n- პუნქტი\n\nYouTube — ჩასვი ბმული ცალკე ხაზზე:\nhttps://youtu.be/VIDEOID"}
              />
              <p className="text-[11px] text-muted-foreground">
                Markdown: ## სათაური · **მუქი** · - სია · YouTube ბმული ცალკე ხაზზე → ვიდეო
              </p>
            </div>
          </div>

          {/* Live preview — the SAME renderer as the public page */}
          <div className="rounded-lg border border-border bg-card p-4 overflow-y-auto max-h-[80vh]">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Preview</p>
            <h1 className="text-2xl font-bold mb-3">{title || "…"}</h1>
            {coverPath && (
              <img src={transformedDisplayUrl(publicUrl(coverPath), { width: 800 })} alt="" className="rounded-xl border border-border mb-4 w-full" />
            )}
            <MarkdownView markdown={body} />
          </div>
        </div>
      </div>
    );
  }

  // ── List view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Newspaper className="h-5 w-5" /> ბლოგი ({posts.length})
        </h2>
        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus className="h-4 w-4 mr-1" /> ახალი სტატია
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {posts.length === 0 && !error && (
        <p className="text-sm text-muted-foreground py-10 text-center">სტატიები არ არის. დაამატე პირველი.</p>
      )}

      <div className="space-y-2">
        {posts.map((p) => (
          <div key={p.id} className={`flex items-center gap-3 rounded-lg border border-border bg-card p-3 ${p.published ? "" : "opacity-70"}`}>
            <div className="h-14 w-20 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
              {p.cover_path ? (
                <img src={transformedDisplayUrl(publicUrl(p.cover_path), { width: 128 })} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <Newspaper className="h-5 w-5 text-muted-foreground/50" />
              )}
            </div>
            <button className="flex-1 min-w-0 text-left" onClick={() => openEditor(p)}>
              <p className="text-sm font-medium truncate">{p.title_ka}</p>
              <p className="text-xs text-muted-foreground truncate">
                /blog/{p.slug} · {format(new Date(p.published_at ?? p.created_at), "dd.MM.yyyy")}
                {!p.published && " · დრაფტი"}
              </p>
            </button>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="h-8 w-8" title={p.published ? "დამალვა" : "გამოქვეყნება"} onClick={() => togglePublished(p)}>
                {p.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="წაშლა" onClick={() => remove(p)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
