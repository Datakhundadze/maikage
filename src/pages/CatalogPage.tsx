import { useSearchParams } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import CatalogGrid from "@/components/catalog/CatalogGrid";
import CatalogRail from "@/components/catalog/CatalogRail";
import CatalogSaleBanner from "@/components/catalog/CatalogSaleBanner";
import { CATALOG_SEO } from "@/lib/pageSeo";

// /designs — the design catalog. Default view: the showroom rail (garments
// hanging on rails, one rail per category). ?view=grid shows the card grid.

export default function CatalogPage() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") === "grid" ? "grid" : "rail";

  return (
    <div className="flex flex-col h-screen">
      <SeoHead
        title={CATALOG_SEO.title}
        description={CATALOG_SEO.description}
        url={`${SITE_URL}/designs`}
      />
      <AppHeader />
      <CatalogSaleBanner />
      {view === "grid" ? <CatalogGrid /> : <CatalogRail />}
    </div>
  );
}
