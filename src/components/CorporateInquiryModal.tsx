import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, Upload, X } from "lucide-react";

interface FormData {
  companyName: string;
  taxId: string;
  contactPerson: string;
  phone: string;
  email: string;
  tshirtQuantity: string;
  color: string;
  comment: string;
  logoFiles: File[];
}

const initial: FormData = {
  companyName: "",
  taxId: "",
  contactPerson: "",
  phone: "",
  email: "",
  tshirtQuantity: "",
  color: "",
  comment: "",
  logoFiles: [],
};

const MAX_LOGO_FILES = 5;
// Mirrors the corporate-logos bucket's server-side file_size_limit — the
// client check just gives a friendly message instead of a storage error.
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

export default function CorporateInquiryModal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormData>(initial);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const set = (key: keyof FormData, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  // Selecting files APPENDS to the list (so a second pick adds, not
  // replaces); oversized files and anything beyond the 5-file cap are
  // rejected with a toast.
  const addLogoFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const tooBig = incoming.filter((f) => f.size > MAX_LOGO_BYTES);
    const accepted = incoming.filter((f) => f.size <= MAX_LOGO_BYTES);
    const room = Math.max(0, MAX_LOGO_FILES - form.logoFiles.length);
    const toAdd = accepted.slice(0, room);
    if (tooBig.length > 0) {
      toast({
        title: "ფაილი აღემატება 5MB-ს",
        description: tooBig.map((f) => f.name).join(", "),
        variant: "destructive",
      });
    }
    if (accepted.length > toAdd.length) {
      toast({ title: `მაქსიმუმ ${MAX_LOGO_FILES} ფაილი`, variant: "destructive" });
    }
    if (toAdd.length > 0) {
      setForm((prev) => ({ ...prev, logoFiles: [...prev.logoFiles, ...toAdd] }));
    }
  };

  const removeLogoFile = (index: number) =>
    setForm((prev) => ({ ...prev, logoFiles: prev.logoFiles.filter((_, i) => i !== index) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName || !form.taxId || !form.contactPerson || !form.phone || !form.email || !form.tshirtQuantity) {
      toast({ title: "შეავსეთ ყველა სავალდებულო ველი", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      // Upload logos in parallel. A failed upload must NOT block the
      // inquiry (logos are optional and the inquiry itself is the value):
      // collect whatever succeeded, warn about the rest after submitting.
      let paths: string[] = [];
      let failedCount = 0;
      if (form.logoFiles.length > 0) {
        const results = await Promise.allSettled(
          form.logoFiles.map(async (file) => {
            const ext = file.name.split(".").pop() || "png";
            const path = `${crypto.randomUUID()}.${ext}`;
            const { error: uploadError } = await supabase.storage
              .from("corporate-logos")
              .upload(path, file, { contentType: file.type });
            if (uploadError) throw uploadError;
            return path;
          }),
        );
        paths = results
          .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
          .map((r) => r.value);
        failedCount = results.length - paths.length;
      }
      const logoPath = paths[0] ?? null;

      // Save to database (logo_path mirrors the first logo for back-compat
      // with old rows / readers; logo_paths holds the full list)
      const { error } = await supabase.from("corporate_inquiries").insert({
        company_name: form.companyName,
        tax_id: form.taxId,
        contact_person: form.contactPerson,
        phone: form.phone,
        email: form.email,
        tshirt_quantity: parseInt(form.tshirtQuantity),
        color: form.color || null,
        comment: form.comment || null,
        logo_path: logoPath,
        logo_paths: paths.length ? paths : null,
      });

      if (error) throw error;

      if (failedCount > 0) {
        toast({
          title: `ლოგო აიტვირთა ${paths.length}/${form.logoFiles.length}`,
          description: "ნაწილი ვერ აიტვირთა — საჭიროების შემთხვევაში მოგვწერეთ ელ.ფოსტაზე.",
          variant: "destructive",
        });
      }

      // Try to send email notification via edge function
      try {
        await supabase.functions.invoke("send-corporate-inquiry", {
          body: {
            companyName: form.companyName,
            taxId: form.taxId,
            contactPerson: form.contactPerson,
            phone: form.phone,
            email: form.email,
            tshirtQuantity: form.tshirtQuantity,
            color: form.color,
            comment: form.comment,
            logoPath,
          },
        });
      } catch {
        // Email notification is best-effort
        console.warn("Email notification failed, but inquiry was saved");
      }

      toast({ title: "მოთხოვნა წარმატებით გაიგზავნა! ✅", description: "მალე დაგიკავშირდებით." });
      setForm(initial);
      setOpen(false);
    } catch (err: any) {
      console.error("Corporate inquiry failed:", err);
      toast({ title: "შეცდომა", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">კორპორატიული შეკვეთა</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>კომპანიის სახელწოდება *</Label>
              <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>საიდენტიფიკაციო კოდი *</Label>
              <Input value={form.taxId} onChange={(e) => set("taxId", e.target.value)} required />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>საკონტაქტო პირი *</Label>
              <Input value={form.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>ტელეფონი *</Label>
              <Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>ელ.ფოსტა *</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>მაისურის რაოდენობა *</Label>
              <Input type="number" min="1" value={form.tshirtQuantity} onChange={(e) => set("tshirtQuantity", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>ფერი</Label>
              <Input value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="მაგ: შავი, თეთრი" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>კომენტარი</Label>
            <Textarea value={form.comment} onChange={(e) => set("comment", e.target.value)} rows={3} placeholder="დამატებითი ინფორმაცია..." />
          </div>

          <div className="space-y-1.5">
            <Label>ატვირთვა ({form.logoFiles.length}/{MAX_LOGO_FILES})</Label>
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-border p-3 hover:bg-muted/50 transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                აირჩიეთ ფაილები (მაქს. {MAX_LOGO_FILES}, თითო ≤5MB)
              </span>
              <input
                type="file"
                multiple
                accept="image/*,.pdf,.ai,.eps,.svg"
                className="hidden"
                onChange={(e) => {
                  addLogoFiles(e.target.files);
                  // reset so re-picking the same file fires onChange again
                  e.target.value = "";
                }}
              />
            </label>
            {form.logoFiles.length > 0 && (
              <ul className="space-y-1">
                {form.logoFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-1.5"
                  >
                    <span className="text-xs text-muted-foreground truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeLogoFile(index)}
                      aria-label="წაშლა"
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Button type="submit" disabled={submitting} className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold h-12">
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>კორპორატიული ფასის გამოთვლა <ArrowRight className="h-4 w-4 ml-2" /></>
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
