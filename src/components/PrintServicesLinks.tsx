import { Link } from "react-router-dom";
import { PRINT_SERVICES_HEADING, SERVICE_LINKS } from "@/lib/serviceRouteSlugs";

// "ბეჭდვის სერვისები" — the four service links (lib/serviceRouteSlugs.ts
// SERVICE_LINKS, exact-match anchors) as plain <a href>, shown at template
// level on every /design/:slug page and every product landing route
// (/hoodie, /t-shirt/gildan, …). The static prerender writes the same block
// (scripts/lib/seo.mjs printServicesHtml).
//
// "sidebar": the constructor column's tokens (ProductLandingPage afterContent).
// "page": the theme's foreground tokens (DesignDetailPage).
const TONES = {
  sidebar: {
    nav: "max-w-prose border-t border-sidebar-border pt-6 text-sm",
    h2: "text-base font-bold leading-snug text-sidebar-foreground mb-2",
    link: "font-medium text-sidebar-foreground underline underline-offset-2 hover:text-primary",
  },
  page: {
    nav: "mt-10 border-t border-border pt-6 text-sm",
    h2: "text-lg font-bold text-foreground mb-2",
    link: "font-medium text-foreground underline underline-offset-2 hover:text-primary",
  },
} as const;

interface PrintServicesLinksProps {
  tone?: keyof typeof TONES;
  /** The current page's path — left out of the list (no self-link on /hoodie). */
  excludeHref?: string;
}

export default function PrintServicesLinks({ tone = "page", excludeHref }: PrintServicesLinksProps) {
  const t = TONES[tone];
  const links = SERVICE_LINKS.filter((l) => l.href !== excludeHref);
  return (
    <nav aria-label={PRINT_SERVICES_HEADING} className={t.nav}>
      <h2 className={t.h2}>{PRINT_SERVICES_HEADING}</h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {links.map((l) => (
          <li key={l.href}>
            <Link to={l.href} className={t.link}>
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
