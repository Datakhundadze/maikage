import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import TourViewer from "@/components/tour/TourViewer";
import { SHOWROOM_INDEXABLE } from "@/lib/showroomSeo";

// /showroom — 360° photo tour of the shop (six panoramas along the aisle).
// Lazy route: this page and everything it imports (Photo Sphere Viewer,
// three.js, the tour config, photos) load only when /showroom is visited.
//
// noindex while the tour is a test — lib/showroomSeo.ts, the one switch the
// sitemap and the static prerender read too.

export default function ShowroomPage() {
  return (
    <div className="flex h-[100dvh] flex-col overscroll-none">
      <SeoHead
        title="ვირტუალური შოურუმი — Maika.ge"
        description="გაიარეთ Maika.ge-ს შოურუმში 3D-ში, პირდაპირ ბრაუზერიდან."
        url={`${SITE_URL}/showroom`}
        noindex={!SHOWROOM_INDEXABLE}
      />
      <AppHeader />
      <main className="relative min-h-0 flex-1">
        <h1 className="sr-only">ვირტუალური შოურუმი</h1>
        <TourViewer />
      </main>
    </div>
  );
}
