import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackMeta } from "@/lib/metaPixel";

declare global {
  interface Window {
    gtag: (...args: unknown[]) => void;
  }
}

export const RouteChangeTracker = () => {
  const location = useLocation();

  useEffect(() => {
    if (typeof window.gtag !== "undefined") {
      window.gtag("config", "G-3NPL6ESFSC", {
        page_path: location.pathname + location.search,
      });
    }
    // Meta pixel PageView on first load and every route change, same trigger
    // as GA above. Independent of gtag; never throws.
    trackMeta("PageView");
  }, [location]);

  return null;
};
