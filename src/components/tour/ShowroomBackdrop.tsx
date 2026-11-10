import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { showroomRackFromHash } from "@/lib/tour/rackItem";
import { SHOWROOM_RACKS } from "@/lib/tour/showroomRacks";

// The constructor, opened from a showroom rack card (URL hash #showroom=<rack>):
// the rack's photo, blurred and dimmed, lies behind the page and the page's
// panels turn see-through, so it feels like the same room (David 2026-11-10).
// Only for a visit that came from the showroom — maika.ge opened directly
// never has the hash and looks as always. Looks only: nothing about the
// constructor's state, prices or ordering is read or changed here.

const CLASS = "maika-from-showroom";

export default function ShowroomBackdrop() {
  // read once: the hash is the hand-over, later hash changes are not ours
  const [rackId] = useState(() => (typeof window === "undefined" ? null : showroomRackFromHash(window.location.hash)));
  const rack = rackId ? SHOWROOM_RACKS.find((r) => r.id === rackId) : undefined;

  useEffect(() => {
    if (!rack) return;
    document.documentElement.classList.add(CLASS);
    return () => document.documentElement.classList.remove(CLASS);
  }, [rack]);

  if (!rack) return null;

  const back = () => {
    // opened by the showroom in a new tab: closing it returns there; otherwise go back / open the showroom
    window.close();
    window.setTimeout(() => {
      if (window.history.length > 1) window.history.back();
      else window.location.assign("/showroom");
    }, 200);
  };

  return (
    <>
      <div aria-hidden className="maika-showroom-backdrop" style={{ backgroundImage: `url(/tour/racks/${rack.id}.webp)` }} />
      <button
        type="button"
        onClick={back}
        className="fixed bottom-3 left-3 z-40 inline-flex h-10 items-center gap-1.5 rounded-full bg-black/60 px-4 text-[13px] font-semibold text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        შოურუმში დაბრუნება
      </button>
    </>
  );
}
