import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { useToast } from "@/hooks/use-toast";

const MAX_MESSAGE = 2000;

// Lightweight feedback collector — opens from a footer link. Inserts directly
// into the `feedback` table (anon + authenticated INSERT RLS, message length
// bounded server-side; mirrors the corporate_inquiries form). No proxy/edge.
// `children` is the trigger element (DialogTrigger asChild).
export default function FeedbackModal({ children }: { children: ReactNode }) {
  const { lang } = useAppState();
  const { user } = useAuth();
  const location = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = message.trim();
    if (!msg) {
      toast({ title: lang === "en" ? "Please write a message" : "შეიყვანე შენიშვნა", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // `feedback` is schema-ahead-of-types — cast mirrors the showroom/portfolio convention.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("feedback").insert({
        message: msg.slice(0, MAX_MESSAGE),
        email: email.trim() || null,
        page: location.pathname,
        user_id: user?.id ?? null,
      });
      if (error) throw error;
      toast({ title: lang === "en" ? "Thank you! Sent ✅" : "მადლობა! გაიგზავნა ✅" });
      setMessage("");
      setEmail("");
      setOpen(false);
    } catch (err) {
      toast({
        title: lang === "en" ? "Couldn't send — please try again" : "ვერ გაიგზავნა — სცადე ხელახლა",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{lang === "en" ? "Feedback" : "შენიშვნა / გამოხმაურება"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="fb-msg">{lang === "en" ? "Your message" : "თქვენი შენიშვნა"} *</Label>
            <Textarea
              id="fb-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MAX_MESSAGE}
              rows={4}
              required
              placeholder={lang === "en" ? "Suggestions, problems, ideas…" : "შენიშვნა, წინადადება, იდეა…"}
            />
            <p className="text-[11px] text-muted-foreground text-right">{message.length}/{MAX_MESSAGE}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fb-email">{lang === "en" ? "Email (optional)" : "ელფოსტა (არასავალდებულო)"}</Label>
            <Input
              id="fb-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={lang === "en" ? "so we can reply" : "რომ გიპასუხოთ"}
            />
          </div>
          <Button type="submit" disabled={submitting || !message.trim()} className="w-full">
            {submitting
              ? (lang === "en" ? "Sending…" : "იგზავნება…")
              : (lang === "en" ? "Send" : "გაგზავნა")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
