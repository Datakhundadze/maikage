import { useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { lovable } from "@/integrations/lovable/index";
import { X } from "lucide-react";

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  message?: string;
}

export default function LoginModal({ open, onClose, message }: LoginModalProps) {
  const { signInWithEmail, signUpWithEmail, error } = useAuth();
  const { lang } = useAppState();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (!error) onClose();
  };

  const handleAppleSignIn = async () => {
    const { error } = await lovable.auth.signInWithOAuth("apple", {
      redirect_uri: window.location.origin,
    });
    if (!error) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0 border-border bg-card overflow-hidden">
        <div className="p-6 pb-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-black text-lg font-black">
                M
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground">maika.ge Studio</h2>
                <p className="text-xs text-muted-foreground">
                  {message || (lang === "ge"
                    ? "გაიარეთ ავტორიზაცია გასაგრძელებლად"
                    : "Sign in to continue generating")}
                </p>
              </div>
            </div>
          </div>

          {/* Social buttons */}
          <div className="space-y-2 mb-4">
            <Button
              variant="outline"
              className="w-full h-11 gap-3 font-medium"
              onClick={handleGoogleSignIn}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google-ით შესვლა
            </Button>
            <Button
              variant="outline"
              className="w-full h-11 gap-3 font-medium"
              onClick={handleAppleSignIn}
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Apple-ით შესვლა
            </Button>
          </div>

          {/* Divider */}
          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">ან</span>
            </div>
          </div>
        </div>

        {/* Email form */}
        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="email"
              placeholder="ელ. ფოსტა"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-11"
            />
            <Input
              type="password"
              placeholder="პაროლი"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-11"
            />
            <Button
              type="submit"
              className="w-full h-11 bg-amber-500 text-black hover:bg-amber-600 font-semibold"
              disabled={loading}
            >
              {loading ? "..." : isSignUp ? "რეგისტრაცია" : "შესვლა"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground mt-3 transition-colors"
          >
            {isSignUp
              ? "უკვე გაქვთ ანგარიში? შესვლა"
              : "არ გაქვთ ანგარიში? რეგისტრაცია"}
          </button>

          {error && (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
