// "design_start": the visitor's first step into designing — a photo picked, a
// text layer added, or an AI prompt sent in the constructor (SimplePage). Sent
// to GA4 through gtag.ts, which mirrors it to the Meta pixel as
// CustomizeProduct (metaPixel.ts).
//
// ONCE PER PAGE VIEW: SimplePage creates one tracker per mount (held in a ref)
// and only the first call sends, so `method` records how the visitor started.
import { trackEvent } from "@/lib/gtag";

export type DesignStartMethod = "upload" | "text" | "ai";

export function createDesignStartTracker(): (method: DesignStartMethod) => void {
  let sent = false;
  return (method) => {
    if (sent) return;
    sent = true;
    trackEvent("design_start", { method });
  };
}
