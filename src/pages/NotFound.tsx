import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Paintbrush, Images } from "lucide-react";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import SeoHead from "@/components/SeoHead";

const NotFound = () => {
  const location = useLocation();
  // The creation tools live at "/" behind a mode switch (not a distinct URL),
  // so the back-to-Home / back-to-Simple links point at "/" and set the mode
  // on click (mirrors AppHeader's logo). The href stays real for crawlers.
  const { lang, setMode } = useAppState();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-6 py-16 text-center text-foreground">
      <SeoHead
        title="გვერდი ვერ მოიძებნა (404) | Maika.ge"
        description="მოთხოვნილი გვერდი არ არსებობს ან გადატანილია. დაბრუნდი მთავარ გვერდზე ან გადახედე ჩვენს კატალოგს."
        noindex
      />

      {/* Brand mark — mirrors the app header's logo */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground text-base font-black">
          M
        </div>
        <span className="text-lg font-bold">maika.ge</span>
      </div>

      {/* 404 + message (Georgian primary, English fallback via i18n) */}
      <div className="space-y-3">
        <p className="text-6xl font-black leading-none text-primary sm:text-7xl">404</p>
        <h1 className="text-2xl font-bold sm:text-3xl">{t(lang, "notFound.title")}</h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
          {t(lang, "notFound.subtitle")}
        </p>
      </div>

      {/* Real <Link> buttons so neither visitors nor crawlers dead-end */}
      <div className="flex w-full max-w-md flex-col flex-wrap items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
        <Button asChild size="lg">
          <Link to="/" onClick={() => setMode("landing")}>
            <Home /> {t(lang, "notFound.home")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/" onClick={() => setMode("simple")}>
            <Paintbrush /> {t(lang, "nav.simple")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to="/designs">
            <Images /> {t(lang, "nav.catalog")}
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
