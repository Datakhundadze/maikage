import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import SplatWalk from "@/components/tour/SplatWalk";

// /showroom/3d — TEST of the shop as a 3D Gaussian splat (Scaniverse) with a
// free walk (components/tour/SplatWalk.tsx). Always noindex and not in the
// sitemap or prerender; /showroom (the 360° video walk) stays the live page
// until this one is chosen. Lazy route: Spark + three.js load only here.

export default function Showroom3DPage() {
  return (
    <div className="flex h-[100dvh] flex-col overscroll-none">
      <SeoHead
        title="ვირტუალური შოურუმი 3D (ტესტი) — Maika.ge"
        description="Maika.ge-ს შოურუმი 3D-ში — სატესტო ვერსია."
        url={`${SITE_URL}/showroom/3d`}
        noindex
      />
      <AppHeader />
      <main className="relative min-h-0 flex-1">
        <h1 className="sr-only">ვირტუალური შოურუმი 3D</h1>
        <SplatWalk />
      </main>
    </div>
  );
}
