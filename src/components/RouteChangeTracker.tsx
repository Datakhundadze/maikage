import { useEffect } from "react";
import { useLocation } from "react-router-dom";

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
  }, [location]);

  return null;
};
