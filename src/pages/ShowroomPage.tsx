import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import PhotoRoomViewer from "@/components/tour/PhotoRoomViewer";
import { SHOWROOM_INDEXABLE } from "@/lib/showroomSeo";

// /showroom — walkable 3D room of the shop, built from photos.
// Lazy route: this page and everything it imports (three.js, the scene config,
// photos) load only when /showroom is visited.
//
// noindex while the photo room is a test — lib/showroomSeo.ts, the one switch
// the sitemap and the static prerender read too.

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
        <PhotoRoomViewer />
      </main>
    </div>
  );
}
