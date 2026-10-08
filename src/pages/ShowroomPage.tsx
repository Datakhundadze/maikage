import AppHeader from "@/components/AppHeader";
import SeoHead, { SITE_URL } from "@/components/SeoHead";
import TourViewer from "@/components/tour/TourViewer";
import { TOUR_NODES, TOUR_START_NODE_ID } from "@/lib/tour/tourConfig";

// /showroom — 360° virtual tour (phase 1: navigation between nodes only).
// Lazy route: this page and everything it imports (Photo Sphere Viewer,
// three.js, the tour CSS) load only when /showroom is visited.
//
// noindex while the tour still shows placeholder panoramas.

export default function ShowroomPage() {
  return (
    <div className="flex h-[100dvh] flex-col">
      <SeoHead
        title="ვირტუალური ტური — Maika.ge"
        description="დაათვალიერეთ Maika.ge-ს სივრცე 360° ხედით."
        url={`${SITE_URL}/showroom`}
        noindex
      />
      <AppHeader />
      <main className="relative min-h-0 flex-1">
        <h1 className="sr-only">ვირტუალური ტური</h1>
        <TourViewer nodes={TOUR_NODES} startNodeId={TOUR_START_NODE_ID} />
      </main>
    </div>
  );
}
