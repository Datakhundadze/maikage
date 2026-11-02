import { Component, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useAppState } from "@/hooks/useAppState";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { homeShowcaseCopy } from "@/lib/homeShowcaseCopy";
import ShowcaseSkeleton from "./ShowcaseSkeleton";

// Home-page slot for the catalog rail + work photos (components/home/
// HomeShowcase.tsx). Kept out of the hero's way: this file is all the
// LandingPage chunk carries; the sections' code (and the catalog's
// GarmentFront / print loader / CSS, shared with /designs) is a separate
// chunk, requested only once the slot is within ~400px of the viewport and
// the browser is idle — so the first paint, and the data fetch, never wait
// on it. Until then a skeleton holds the section's box.
//
// A chunk that still fails after lazyWithRetry's retries is caught here and
// the sections just don't render (this is not a page; the router-level
// ChunkErrorBoundary must not blank the home page for it).

const HomeShowcase = lazyWithRetry(() => import("./HomeShowcase"));

class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.warn("[home-showcase] failed to load", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

export default function HomeShowcaseSlot() {
  const { lang, theme } = useAppState();
  const isGreen = theme === "green";
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = window as IdleWindow;
    let cancelIdle = () => {};
    const start = () => {
      if (w.requestIdleCallback && w.cancelIdleCallback) {
        const id = w.requestIdleCallback(() => setReady(true), { timeout: 1500 });
        cancelIdle = () => w.cancelIdleCallback?.(id);
      } else {
        const id = window.setTimeout(() => setReady(true), 200);
        cancelIdle = () => window.clearTimeout(id);
      }
    };
    if (typeof IntersectionObserver === "undefined") {
      start();
      return () => cancelIdle();
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelIdle();
    };
  }, []);

  const skeleton = <ShowcaseSkeleton copy={homeShowcaseCopy(lang)} isGreen={isGreen} />;
  return (
    <div ref={ref} className="w-full">
      {ready ? (
        <QuietBoundary>
          <Suspense fallback={skeleton}>
            <HomeShowcase />
          </Suspense>
        </QuietBoundary>
      ) : (
        skeleton
      )}
    </div>
  );
}
