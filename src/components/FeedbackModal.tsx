import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitFeedback, MAX_FEEDBACK_MESSAGE } from "@/lib/feedback";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { useToast } from "@/hooks/use-toast";

// Lightweight feedback collector — opens from a footer link. Writes to the
// `feedback` table (anon + authenticated INSERT RLS, message length bounded
// server-side; mirrors the corporate_inquiries form). No proxy/edge.
// `children` is the trigger element (DialogTrigger asChild).
//
// The insert itself now lives in lib/feedback so the post-order form on the
// confirmation page writes the identical row shape. Behaviour here is
// unchanged: same fields, same toasts, same empty-message guard.
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
    // No order to attach from the footer — orderId stays null here.
    const { error } = await submitFeedback({
      message: msg,
      email,
      page: location.pathname,
      userId: user?.id ?? null,
    });
    setSubmitting(false);
    if (error) {
      toast({
        title: lang === "en" ? "Couldn't send — please try again" : "ვერ გაიგზავნა — სცადე ხელახლა",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: lang === "en" ? "Thank you! Sent ✅" : "მადლობა! გაიგზავნა ✅" });
    setMessage("");
    setEmail("");
    setOpen(false);
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
              maxLength={MAX_FEEDBACK_MESSAGE}
              rows={4}
              required
              placeholder={lang === "en" ? "Suggestions, problems, ideas…" : "შენიშვნა, წინადადება, იდეა…"}
            />
            <p className="text-[11px] text-muted-foreground text-right">{message.length}/{MAX_FEEDBACK_MESSAGE}</p>
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
