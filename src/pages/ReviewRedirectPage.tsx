import { useEffect } from "react";
import { trackEvent } from "@/lib/gtag";

// Short, printable link for Google reviews: maika.ge/review (QR cards in the
// showroom, Messenger/DM replies after pickup or delivery). Sends one GA4
// event so we can count opens, then forwards to Google's "write a review"
// dialog for the maika.ge Business Profile. The link target lives here, so
// it can change later without reprinting the QR.
export const GOOGLE_REVIEW_URL =
  "https://search.google.com/local/writereview?placeid=ChIJM6zu-sdzREARm6l1_dAKhVE";

export default function ReviewRedirectPage() {
  useEffect(() => {
    const src = new URLSearchParams(window.location.search).get("src") || "direct";
    trackEvent("review_link_open", { source: src });
    const t = window.setTimeout(() => window.location.replace(GOOGLE_REVIEW_URL), 150);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
      <p className="text-lg font-semibold">მადლობა, რომ maika.ge აირჩიე! 🧡</p>
      <p className="text-muted-foreground">გადაგიყვანთ Google-ზე შეფასების დასაწერად…</p>
      <a className="text-primary underline" href={GOOGLE_REVIEW_URL}>
        თუ ავტომატურად არ გადავიდა, დააჭირე აქ
      </a>
    </div>
  );
}
