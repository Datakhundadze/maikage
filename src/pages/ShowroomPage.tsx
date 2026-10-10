import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import SplatViewer from "@/components/tour/SplatViewer";

// /showroom — walkable 3D scan of the shop (Gaussian splats).
// Lazy route: this page and everything it imports (three.js, Spark, the scan
// config) load only when /showroom is visited.
//
// noindex while the scene is a test scan of one corner of the shop.

export default function ShowroomPage() {
  return (
    <div className="flex h-[100dvh] flex-col overscroll-none">
      <SeoHead
        title="ვირტუალური შოურუმი — Maika.ge"
        description="გაიარეთ Maika.ge-ს შოურუმში 3D-ში, პირდაპირ ბრაუზერიდან."
        url={`${SITE_URL}/showroom`}
        noindex
      />
      <AppHeader />
      <main className="relative min-h-0 flex-1">
        <h1 className="sr-only">ვირტუალური შოურუმი</h1>
        <SplatViewer />
      </main>
    </div>
  );
}
