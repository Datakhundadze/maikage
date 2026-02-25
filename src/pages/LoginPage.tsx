import { useAuth } from "@/hooks/useAuth";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const { signInWithGoogle, signInAsGuest, error } = useAuth();
  const { lang } = useAppState();

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      {/* Top banana gradient bar */}
      <div className="fixed top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-banana-400 via-banana-500 to-banana-600" />

      <div className="w-full max-w-md p-8">
        <div className="rounded-2xl border bg-card p-8 shadow-2xl">
          {/* Logo */}
          <div className="mb-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground rotate-3">
              M
            </div>
          </div>

          {/* Title */}
          <h1 className="mb-1 text-center text-2xl font-bold text-foreground">
            {t(lang, "login.title")}
          </h1>
          <p className="mb-8 text-center text-sm text-muted-foreground">
            {t(lang, "login.subtitle")}
          </p>

          {/* Google Sign In */}
          <Button
            variant="outline"
            className="mb-3 w-full gap-3 h-12"
            onClick={signInWithGoogle}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {t(lang, "login.google")}
          </Button>

          {/* Guest Sign In */}
          <Button
            className="w-full h-12 bg-banana-500 text-foreground hover:bg-banana-600 font-semibold"
            onClick={signInAsGuest}
          >
            {t(lang, "login.guest")} →
          </Button>

          {/* Error */}
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
