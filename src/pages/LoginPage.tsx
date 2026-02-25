import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const { signInWithEmail, signUpWithEmail, signInAsGuest, error } = useAuth();
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-banana-400 via-banana-500 to-banana-600" />

      <div className="w-full max-w-md p-8">
        <div className="rounded-2xl border bg-card p-8 shadow-2xl">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground rotate-3">
              M
            </div>
          </div>

          <h1 className="mb-1 text-center text-2xl font-bold text-foreground">
            {t(lang, "login.title")}
          </h1>
          <p className="mb-8 text-center text-sm text-muted-foreground">
            {t(lang, "login.subtitle")}
          </p>

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-3 mb-4">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-12"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="h-12"
            />
            <Button
              type="submit"
              className="w-full h-12 bg-banana-500 text-foreground hover:bg-banana-600 font-semibold"
              disabled={loading}
            >
              {loading ? "..." : isSignUp ? "Sign Up" : "Sign In"}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
          </button>

          <div className="relative mb-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          {/* Guest */}
          <Button
            variant="outline"
            className="w-full h-12"
            onClick={signInAsGuest}
          >
            {t(lang, "login.guest")} →
          </Button>

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
