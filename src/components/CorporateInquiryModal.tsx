import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Loader2, Upload } from "lucide-react";

interface FormData {
  companyName: string;
  taxId: string;
  contactPerson: string;
  phone: string;
  email: string;
  tshirtQuantity: string;
  color: string;
  comment: string;
  logoFile: File | null;
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
  logoFile: null,
};

export default function CorporateInquiryModal({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormData>(initial);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const set = (key: keyof FormData, value: string | File | null) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.companyName || !form.taxId || !form.contactPerson || !form.phone || !form.email || !form.tshirtQuantity) {
      toast({ title: "შეავსეთ ყველა სავალდებულო ველი", variant: "destructive" });
      return;
    }

    setSubmitting(true);
    try {
      let logoPath: string | null = null;

      // Upload logo if provided
      if (form.logoFile) {
        const ext = form.logoFile.name.split(".").pop() || "png";
        const path = `${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("corporate-logos")
          .upload(path, form.logoFile, { contentType: form.logoFile.type });
        if (uploadError) throw uploadError;
        logoPath = path;
      }

      // Save to database
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
      });

      if (error) throw error;

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
            <Label>ატვირთვა</Label>
            <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-border p-3 hover:bg-muted/50 transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {form.logoFile ? form.logoFile.name : "აირჩიეთ ფაილი"}
              </span>
              <input
                type="file"
                accept="image/*,.pdf,.ai,.eps,.svg"
                className="hidden"
                onChange={(e) => set("logoFile", e.target.files?.[0] || null)}
              />
            </label>
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
