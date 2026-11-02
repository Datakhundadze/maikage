import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAppState } from "@/hooks/useAppState";
import { GarmentFront, loadScene, mockupFor, type DesignRow, type ShowroomScene } from "@/components/catalog/CatalogRail";
import { HOME_CATALOG_LIMIT, homeShowcaseCopy } from "@/lib/homeShowcaseCopy";
import ShowcaseSkeleton, { ShowcaseHeading } from "./ShowcaseSkeleton";
import "./homeShowcase.css";

// Home "მზა დიზაინები" — a swipeable rail of catalog designs, drawn exactly as
// the /designs showroom draws them: the catalog's own GarmentFront (blank
// garment photo from public/showroom + the design's print through the
// catalog's printLoader + shade map), the garment picked by the catalog's
// mockupFor(), sizes from the same showroom.json (loadScene). No new
// rendering pipeline and no AI/generation call.
//
// Data: catalog_designs, the catalog's own filter (is_published) and select.
// Order: is_featured first (the admin "★" toggle in the catalog tab), then
// newest — there is no other popularity signal (order_count/view_count are
// never written). Each garment is a real <a href="/design/:slug">, with the
// same onClick the catalog's grid card and stage CTA run (setMode("simple"))
// — guarded to plain clicks, because on "/" a modified click (new tab) would
// otherwise switch THIS tab's home into the constructor.
//
// Mounted lazily by HomeShowcaseSlot once the section nears the viewport.
// Fetch error / no rows / no showroom.json → renders nothing.

type HomeDesign = DesignRow & { title_en: string | null };

const SELECT =
  "id, slug, title_ka, title_en, thumbnail_url, print_file_url, category, created_at, default_color, default_product_id, product:products!catalog_designs_default_product_id_fkey(type, display_name_ka, slug)";

const isPlainClick = (e: React.MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

interface ItemProps {
  d: HomeDesign;
  scene: ShowroomScene;
  title: string;
  track: HTMLDivElement | null;
  onPick: (e: React.MouseEvent) => void;
}

/** One garment; its images mount only when within ~1 rail width of the visible part. */
function ShowcaseItem({ d, scene, title, track, onPick }: ItemProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [near, setNear] = useState(false);
  const m = mockupFor(d);
  const [fw, fh] = (scene.garments[m] ?? scene.garments.white).front;

  useEffect(() => {
    const el = ref.current;
    if (!el || !track || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { root: track, rootMargin: "0px 100% 0px 100%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [track, near]);

  return (
    <Link ref={ref} to={`/design/${d.slug}`} onClick={onPick} className="hs-item" aria-label={title}>
      <div className="hs-garment" style={{ "--ar": `${fw}/${fh}` } as React.CSSProperties}>
        <div className="cr-shadow" />
        {near ? <GarmentFront design={d} scene={scene} className="cr-face cr-front" /> : <div className="hs-garment-wait" />}
      </div>
      <span className="hs-title" aria-hidden="true">
        {title}
      </span>
    </Link>
  );
}

export default function HomeCatalogShowcase() {
  const { lang, theme, setMode } = useAppState();
  const isGreen = theme === "green";
  const copy = homeShowcaseCopy(lang);
  const [designs, setDesigns] = useState<HomeDesign[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [scene, setScene] = useState<ShowroomScene | null>(null);
  const [failed, setFailed] = useState(false);
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog_designs is not in the generated types (same cast as the catalog)
        const { data, count, error } = await (supabase as any)
          .from("catalog_designs")
          .select(SELECT, { count: "exact" })
          .eq("is_published", true)
          .order("is_featured", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(HOME_CATALOG_LIMIT);
        if (cancelled) return;
        if (error || !Array.isArray(data) || data.length === 0) {
          setFailed(true);
          return;
        }
        setDesigns(data as HomeDesign[]);
        setTotal(typeof count === "number" ? count : null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    loadScene()
      .then((s) => !cancelled && setScene(s))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Arrow state: hide "prev" at the start and "next" at the end.
  const measure = useCallback(() => {
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setEdges({ start: track.scrollLeft <= 4, end: track.scrollLeft >= max - 4 });
  }, [track]);
  useEffect(() => {
    if (!track) return;
    measure();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      track.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [track, measure, designs, scene]);

  const scrollByPage = (dir: 1 | -1) => {
    if (!track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  // Same as the catalog's card / stage CTA (setMode("simple") before the route changes).
  const onPick = useCallback(
    (e: React.MouseEvent) => {
      if (isPlainClick(e)) setMode("simple");
    },
    [setMode],
  );

  if (failed) return null;
  if (!designs || !scene) return <ShowcaseSkeleton copy={copy} isGreen={isGreen} />;

  const titleOf = (d: HomeDesign) => (lang === "en" && d.title_en ? d.title_en : d.title_ka);

  return (
    <section aria-labelledby="home-catalog-title" className="w-full max-w-5xl mx-auto mb-16 sm:mb-20">
      <ShowcaseHeading copy={copy} isGreen={isGreen} />
      <div className="hs-panel">
        <div ref={setTrack} className="hs-track">
          <div className="hs-rail-wrap">
            <div className="cr-rail" aria-hidden="true">
              <img className="l" src="/showroom/rail-left.webp" alt="" />
              <div className="m" />
              <img className="r" src="/showroom/rail-right.webp" alt="" />
            </div>
            {designs.map((d) => (
              <ShowcaseItem key={d.id} d={d} scene={scene} title={titleOf(d)} track={track} onPick={onPick} />
            ))}
            <Link to="/designs" className="hs-item hs-cta">
              <span className="hs-cta-card">
                <strong>{copy.catalogCta} →</strong>
                {total ? <small>{copy.designsCount(total)}</small> : null}
              </span>
            </Link>
          </div>
        </div>
        <button
          type="button"
          className="hs-arrow hs-arrow--prev hidden md:flex"
          aria-label={copy.prev}
          disabled={edges.start}
          onClick={() => scrollByPage(-1)}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="hs-arrow hs-arrow--next hidden md:flex"
          aria-label={copy.next}
          disabled={edges.end}
          onClick={() => scrollByPage(1)}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </section>
  );
}
