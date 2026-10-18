import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import VideoWalk from "@/components/tour/VideoWalk";
import { SHOWROOM_INDEXABLE } from "@/lib/showroomSeo";

// /showroom — walk around the shop in a 360° video, with a joystick
// (components/tour/VideoWalk.tsx). Lazy route: this page and everything it
// imports (three.js, the walk track) load only when /showroom is visited; the
// videos stream from public/tour/walk/.
//
// The earlier 360° photo tour (TourViewer.tsx, six panoramas in
// public/tour/360/) stays in the repo for now as the fallback.
//
// noindex while the tour is a test — lib/showroomSeo.ts, the one switch the
// sitemap and the static prerender read too.

export default function ShowroomPage() {
  return (
    <div className="flex h-[100dvh] flex-col overscroll-none">
      <SeoHead
        title="ვირტუალური შოურუმი — Maika.ge"
        description="გაიარეთ Maika.ge-ს შოურუმში 360° ვიდეოში, პირდაპირ ბრაუზერიდან."
        url={`${SITE_URL}/showroom`}
        noindex={!SHOWROOM_INDEXABLE}
      />
      <AppHeader />
      <main className="relative min-h-0 flex-1">
        <h1 className="sr-only">ვირტუალური შოურუმი</h1>
        <VideoWalk />
      </main>
    </div>
  );
}
