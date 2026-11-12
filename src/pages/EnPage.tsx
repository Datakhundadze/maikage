import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowLeft } from "lucide-react";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import NotFound from "@/pages/NotFound";
import type { ServiceLink } from "@/lib/serviceCopy";
import {
  EN_GEORGIAN_LINK_LABEL,
  EN_HOME_LABEL,
  EN_PAGES,
  EN_SERVICES_HEADING,
  enAlternates,
  enSchemas,
  enServiceLinksFor,
  type EnPageCopy,
} from "@/lib/enPages";

// English pages (/en, /en/dtf-printing, …). Purely presentational: every
// string, the title / description, the hreflang alternates and the JSON-LD
// come from lib/enPages.ts — the same data the static prerender writes to
// dist/en/<slug>/index.html, so a crawler gets the same text before JS.
// Layout and palette: ServicePage's.

const linkClass =
  "font-medium text-gray-900 dark:text-white underline underline-offset-2 hover:text-amber-500 transition-colors";

function AnyLink({ link, className = linkClass }: { link: ServiceLink; className?: string }) {
  if (link.href.startsWith("/")) {
    return (
      <Link to={link.href} className={className}>
        {link.label}
      </Link>
    );
  }
  const external = link.href.startsWith("http");
  return (
    <a href={link.href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {link.label}
    </a>
  );
}

function LinkRow({ links }: { links: ServiceLink[] }) {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((l) => (
        <AnyLink key={l.href + l.label} link={l} />
      ))}
    </p>
  );
}

function EnPageView({ page }: { page: EnPageCopy }) {
  const isHub = page.path === "/en";
  return (
    <div lang="en" className="min-h-screen bg-white dark:bg-[#0a0a0a] text-gray-900 dark:text-white">
      <SeoHead title={page.seo.title} description={page.seo.description} url={`${SITE_URL}${page.path}`} schemas={enSchemas(page)} />
      <Helmet htmlAttributes={{ lang: "en" }}>
        <meta property="og:locale" content="en_US" />
        <meta property="og:locale:alternate" content="ka_GE" />
        {enAlternates(page).map((a) => (
          <link key={a.hreflang} rel="alternate" hrefLang={a.hreflang} href={a.href} />
        ))}
      </Helmet>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <nav aria-label="breadcrumb" className="mb-8 flex items-center justify-between text-sm text-gray-500 dark:text-white/40">
          {isHub ? (
            <span />
          ) : (
            <Link to="/en" className="inline-flex items-center gap-2 hover:text-gray-900 dark:hover:text-white transition-colors">
              <ArrowLeft className="h-4 w-4" />
              {EN_HOME_LABEL}
            </Link>
          )}
          <Link to={page.kaPath} lang="ka" className="hover:text-gray-900 dark:hover:text-white transition-colors">
            {EN_GEORGIAN_LINK_LABEL}
          </Link>
        </nav>

        <h1 className="text-3xl font-bold mb-4">{page.h1}</h1>
        <p className="text-gray-600 dark:text-white/60 leading-relaxed mb-6">{page.intro}</p>
        <div className="mb-10 flex flex-wrap gap-3">
          {page.heroLinks.map((l, i) => (
            <AnyLink
              key={l.href + l.label}
              link={l}
              className={
                i === 0
                  ? "inline-flex items-center rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-semibold px-5 py-2.5 text-sm transition-colors"
                  : "inline-flex items-center rounded-xl border border-gray-300 dark:border-white/20 hover:border-amber-500 font-semibold px-5 py-2.5 text-sm transition-colors"
              }
            />
          ))}
        </div>

        {page.images && page.images.length > 0 && (
          <div className="mb-10 grid grid-cols-2 gap-4">
            {page.images.map((img) => (
              <img
                key={img.src}
                src={img.src}
                alt={img.alt}
                width={img.width}
                height={img.height}
                loading="lazy"
                decoding="async"
                className="w-full h-auto rounded-2xl bg-gray-100 dark:bg-white/5 object-contain"
              />
            ))}
          </div>
        )}

        <div className="space-y-8 text-sm leading-relaxed text-gray-600 dark:text-white/60">
          {page.sections.map((s) => (
            <section key={s.h2} className="space-y-3">
              <h2 className="text-xl font-bold leading-snug text-gray-900 dark:text-white">{s.h2}</h2>
              {s.body !== undefined && <p>{s.body}</p>}
              {s.bullets && s.bullets.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {s.bullets.map((b) => (
                    <li key={b.term}>
                      <strong className="font-semibold text-gray-900 dark:text-white">{b.term}</strong> — {b.text}
                    </li>
                  ))}
                </ul>
              )}
              {s.steps && s.steps.length > 0 && (
                <ol className="list-decimal space-y-1 pl-5">
                  {s.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {s.note !== undefined && <p>{s.note}</p>}
              {s.links && s.links.length > 0 && <LinkRow links={s.links} />}
            </section>
          ))}

          <section className="space-y-4">
            <h2 className="text-xl font-bold leading-snug text-gray-900 dark:text-white">{page.faqHeading}</h2>
            {page.faq.map((item) => (
              <div key={item.q} className="space-y-1">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{item.q}</h3>
                <p>{item.a}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3 rounded-2xl border border-gray-200 dark:border-white/10 p-6">
            <h2 className="text-xl font-bold leading-snug text-gray-900 dark:text-white">{page.cta.h2}</h2>
            <p>{page.cta.body}</p>
            <LinkRow links={page.cta.links} />
          </section>
        </div>

        <nav aria-label={EN_SERVICES_HEADING} className="mt-10 border-t border-gray-200 dark:border-white/10 pt-6 text-sm">
          <h2 className="text-lg font-bold mb-2">{EN_SERVICES_HEADING}</h2>
          <LinkRow links={enServiceLinksFor(page.path)} />
        </nav>
      </main>
    </div>
  );
}

export default function EnPage({ path }: { path: string }) {
  const page = Object.prototype.hasOwnProperty.call(EN_PAGES, path) ? EN_PAGES[path] : undefined;
  if (!page) return <NotFound />;
  return <EnPageView page={page} />;
}
