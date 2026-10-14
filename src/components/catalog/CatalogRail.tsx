import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppState } from "@/hooks/useAppState";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES, CATEGORY_LABEL_BY_SLUG } from "@/lib/categories";
import { kick, mkBody, release, setRailReducedMotion, wake, type RailBody } from "@/lib/railPhysics";
import "./catalogRail.css";

// /designs default view — the showroom rail, ported from the rail prototype.
//
// One rail per category. Garments hang side-on; on a mouse, hovering one turns
// it to face you (spring), shoves its neighbours (ripple), and brushing the
// cursor through the rail pushes the clothes; scrolling a rail swings them by
// inertia; rails drop in on first view. On touch the garment nearest the rail
// centre turns; tapping another turns and centres it, tapping the turned one
// opens it. Opening flies the garment to a "stage" with its details and the
// order button.
//
// Each garment is a real <a href="/design/:slug"> so the catalog stays
// crawlable; plain clicks are handled here (preventDefault) to turn/open.
// Rails mount their garments only within ~1 viewport of the screen and load
// the design images only once visible.

interface DesignRow {
  id: string;
  slug: string;
  title_ka: string;
  thumbnail_url: string | null;
  print_file_url: string;
  category: string | null;
  created_at: string;
  default_color: string | null;
}

interface ShowroomScene {
  printBox: { l: number; t: number; w: number; h: number };
  garments: Record<string, { front: [number, number]; side: [number, number] }>;
}

// ── Mockups ─────────────────────────────────────────────────────────────────
// Blank tees in public/showroom: tee-<key>-{front,side,shade}.webp, sizes in
// showroom.json. A design's default_color (any case) picks the tee; anything
// unlisted wears white. New colour on an existing tee = one line in
// MOCKUP_BY_COLOR; a new tee = its files + one line in MOCKUPS.
const MOCKUPS = {
  white: { dot: "#f3f2ee", label_ka: "თეთრი", light: true },
  black: { dot: "#1f2023", label_ka: "შავი", light: false },
  navy: { dot: "#202a43", label_ka: "მუქი ლურჯი", light: false },
} as const;
type MockupKey = keyof typeof MOCKUPS;

const MOCKUP_BY_COLOR: Record<string, MockupKey> = {
  white: "white",
  black: "black",
  "dark navy": "navy",
  gray: "white",
  yellow: "white",
  green: "navy",
  red: "black",
  "sol's electric": "navy",
};

const mockupFor = (color: string | null): MockupKey => MOCKUP_BY_COLOR[(color || "white").toLowerCase()] ?? "white";
const teeSrc = (m: MockupKey, part: "front" | "side" | "shade") => `/showroom/tee-${m}-${part}.webp`;

let scenePromise: Promise<ShowroomScene> | null = null;
function loadScene(): Promise<ShowroomScene> {
  scenePromise ??= fetch("/showroom/showroom.json").then((r) => {
    if (!r.ok) throw new Error(`showroom.json: HTTP ${r.status}`);
    return r.json() as Promise<ShowroomScene>;
  });
  return scenePromise;
}

// ── Print trimming ──────────────────────────────────────────────────────────
// Designs often carry wide transparent margins; trimmed to their opaque
// bounding box they sit right in the print box. Best effort: if the image
// can't be read (CORS-tainted canvas) or anything else fails, the original
// URL is used untouched.
const trimCache = new Map<string, Promise<string>>();

function trimTransparent(url: string): Promise<string> {
  let p = trimCache.get(url);
  if (!p) {
    p = new Promise<string>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onerror = () => resolve(url);
      img.onload = () => {
        try {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          if (!w || !h) return resolve(url);
          const s = Math.min(1, 400 / Math.max(w, h));
          const cw = Math.max(1, Math.round(w * s));
          const ch = Math.max(1, Math.round(h * s));
          const c = document.createElement("canvas");
          c.width = cw;
          c.height = ch;
          const ctx = c.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(url);
          ctx.drawImage(img, 0, 0, cw, ch);
          const data = ctx.getImageData(0, 0, cw, ch).data; // throws if tainted
          let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              if (data[(y * cw + x) * 4 + 3] > 20) {
                if (x < x0) x0 = x;
                if (x > x1) x1 = x;
                if (y < y0) y0 = y;
                if (y > y1) y1 = y;
              }
            }
          }
          if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === cw - 1 && y1 === ch - 1)) return resolve(url);
          // crop the original at full resolution (capped at 800 px)
          const sx = x0 / s, sy = y0 / s, sw = (x1 - x0 + 1) / s, sh = (y1 - y0 + 1) / s;
          const o = Math.min(1, 800 / Math.max(sw, sh));
          const out = document.createElement("canvas");
          out.width = Math.max(1, Math.round(sw * o));
          out.height = Math.max(1, Math.round(sh * o));
          out.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
          resolve(out.toDataURL("image/png"));
        } catch {
          resolve(url);
        }
      };
      img.src = url;
    });
    trimCache.set(url, p);
  }
  return p;
}

function useTrimmedPrint(url: string, enabled: boolean): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !url) return;
    let alive = true;
    trimTransparent(url).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [url, enabled]);
  return enabled ? src : null;
}

// ── Garment front (tee + print + shade) ─────────────────────────────────────
interface FrontProps {
  design: DesignRow;
  scene: ShowroomScene;
  loadPrint: boolean;
  className: string;
  style?: React.CSSProperties;
}

const GarmentFront = forwardRef<HTMLDivElement, FrontProps>(function GarmentFront(
  { design, scene, loadPrint, className, style },
  ref,
) {
  const m = mockupFor(design.default_color);
  const print = useTrimmedPrint(design.thumbnail_url || design.print_file_url, loadPrint);
  const B = scene.printBox;
  const box: React.CSSProperties = { left: `${B.l * 100}%`, top: `${B.t * 100}%`, width: `${B.w * 100}%`, height: `${B.h * 100}%` };
  return (
    <div ref={ref} className={`${className} ${MOCKUPS[m].light ? "cr-light" : "cr-dark"}`} style={style}>
      <img src={teeSrc(m, "front")} alt="" draggable={false} />
      {print && <img className="cr-print" src={print} alt="" decoding="async" draggable={false} style={box} />}
      <img className="cr-shade" src={teeSrc(m, "shade")} alt="" draggable={false} style={box} />
    </div>
  );
});

// ── Rails ───────────────────────────────────────────────────────────────────
interface Rack {
  slug: string;
  label: string;
  items: DesignRow[];
}

interface RailApi {
  setOn: (g: HTMLAnchorElement | null) => void;
  centre: (g: HTMLAnchorElement, smooth: boolean) => void;
  track: HTMLDivElement;
}

interface GarmentHandle {
  el: HTMLAnchorElement;
  body: RailBody;
  rail: RailApi;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface RailSectionProps {
  rack: Rack;
  start: number;
  scene: ShowroomScene;
  scrollRoot: HTMLElement | null;
  fine: boolean;
  reduce: boolean;
  registry: Map<number, GarmentHandle>;
  onOpen: (index: number, el: HTMLAnchorElement) => void;
}

function RailSection({ rack, start, scene, scrollRoot, fine, reduce, registry, onOpen }: RailSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const garmentEls = useRef<(HTMLAnchorElement | null)[]>([]);
  const bodiesRef = useRef<RailBody[]>([]);
  const railRef = useRef<RailApi | null>(null);
  const droppedRef = useRef(false);
  const onOpenRef = useRef(onOpen);
  const [near, setNear] = useState(false);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  // Mount garments within ~1 viewport; load images once actually visible.
  useEffect(() => {
    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track || !scrollRoot) return;
    const nearIo = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: scrollRoot,
      rootMargin: "100% 0px",
    });
    const seenIo = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          seenIo.disconnect();
        }
      },
      { root: scrollRoot, threshold: 0.2 },
    );
    nearIo.observe(section);
    seenIo.observe(track);
    return () => {
      nearIo.disconnect();
      seenIo.disconnect();
    };
  }, [scrollRoot]);

  // Bodies, sizing and the rail's interactions, while the garments are mounted.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!near || !track) return;
    const els = garmentEls.current.slice(0, rack.items.length).filter((g): g is HTMLAnchorElement => !!g);
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    const sizes: { swW: number; fwW: number }[] = [];
    const bodies = els.map((g, j) => {
      const sw = g.querySelector<HTMLElement>(".cr-swing")!;
      const sd = g.querySelector<HTMLElement>(".cr-side")!;
      const fr = g.querySelector<HTMLElement>(".cr-front")!;
      sizes[j] = { swW: 0, fwW: 0 };
      const b = mkBody({
        render(t: number) {
          const { swW, fwW } = sizes[j];
          const p = Math.max(0, b.p);
          const q = Math.min(p, 1);
          g.style.width = (swW + (fwW - swW) * Math.min(p, 1.06)).toFixed(1) + "px";
          const ang = p * 180;
          if (ang < 90) {
            sd.style.opacity = "1";
            fr.style.opacity = "0";
            sd.style.transform = `translateX(-50%) rotateY(${ang.toFixed(2)}deg)`;
          } else {
            sd.style.opacity = "0";
            fr.style.opacity = "1";
            fr.style.transform = `translateX(-50%) translateY(${(7 * q).toFixed(2)}px) scale(${(1 + 0.08 * Math.min(p, 1.15)).toFixed(4)}) rotateY(${(ang - 180).toFixed(2)}deg)`;
          }
          const lift = -10 * Math.sin(Math.PI * clamp(b.p, 0, 1));
          sw.style.transform = `translateY(${(b.y + lift).toFixed(2)}px) rotate(${b.th.toFixed(3)}deg)`;
          sw.style.opacity = b.hold && t < b.hold ? "0" : "1";
        },
      });
      return b;
    });
    bodiesRef.current = bodies;

    const sizeAll = () => {
      const H = parseFloat(getComputedStyle(track).getPropertyValue("--H")) || 300;
      els.forEach((g, j) => {
        const dims = scene.garments[g.dataset.m ?? "white"] ?? scene.garments.white;
        const [fw, fh] = dims.front;
        const [sw, sh] = dims.side;
        sizes[j] = { swW: Math.round((sw / sh) * H * 0.62), fwW: Math.round((fw / fh) * H) };
        g.querySelector<HTMLElement>(".cr-side")!.style.width = Math.round((sw / sh) * H) + "px";
        g.querySelector<HTMLElement>(".cr-front")!.style.width = sizes[j].fwW + "px";
        bodies[j].render(0);
      });
    };
    sizeAll();
    window.addEventListener("resize", sizeAll);

    // turning one garment: it springs round, its neighbours get shoved and swing
    let onEl: HTMLAnchorElement | null = null;
    const setOn = (g: HTMLAnchorElement | null) => {
      const prev = onEl;
      if (prev === g) return;
      if (prev) {
        prev.classList.remove("on");
        const pb = bodies[els.indexOf(prev)];
        if (pb) {
          pb.pt = 0;
          wake(pb);
          kick(pb, (Math.random() < 0.5 ? 1 : -1) * 22, 60);
        }
      }
      onEl = g;
      track.classList.toggle("has-on", !!g);
      if (!g) return;
      g.classList.add("on");
      const i = els.indexOf(g);
      const b = bodies[i];
      if (!b) return;
      b.pt = 1;
      wake(b);
      bodies.forEach((x, j) => {
        const d = Math.abs(j - i);
        if (!d || d > 6) return;
        kick(x, ((j < i ? 1 : -1) * 48) / Math.pow(d, 0.8), 20 + d * 45);
      });
      kick(b, (Math.random() < 0.5 ? 1 : -1) * 30, 180);
    };
    let autoUntil = 0; // programmatic smooth scroll in progress: don't re-pick
    const centre = (g: HTMLAnchorElement, smooth: boolean) => {
      autoUntil = performance.now() + 900;
      track.scrollTo({ left: g.offsetLeft + g.offsetWidth / 2 - track.clientWidth / 2, behavior: smooth ? "smooth" : "auto" });
    };
    const rail: RailApi = { setOn, centre, track };
    railRef.current = rail;
    els.forEach((el, j) => registry.set(start + j, { el, body: bodies[j], rail }));

    // inertia: the rail moves, the garments lag behind and swing back when it stops
    let last = track.scrollLeft;
    let lt = performance.now();
    let v = 0;
    let stopTimer = 0;
    const shove = (dv: number) => bodies.forEach((b) => kick(b, clamp(-dv * 14 * (0.8 + Math.random() * 0.4), -45, 45)));
    const onScroll = () => {
      const now = performance.now();
      const nv = (track.scrollLeft - last) / Math.max(8, now - lt);
      last = track.scrollLeft;
      lt = now;
      if (Math.abs(nv - v) > 0.15) {
        shove(nv - v);
        v = nv;
      }
      window.clearTimeout(stopTimer);
      stopTimer = window.setTimeout(() => {
        shove(-v);
        v = 0;
      }, 90);
    };
    track.addEventListener("scroll", onScroll, { passive: true });

    const cleanups: (() => void)[] = [];
    if (fine) {
      const onOver = (e: PointerEvent) => {
        const g = (e.target as Element).closest<HTMLAnchorElement>(".cr-g");
        if (g) setOn(g);
      };
      const onLeave = () => setOn(null);
      // brushing: running the cursor through the rail pushes the clothes it passes
      const onMove = (e: PointerEvent) => {
        const g = (e.target as Element).closest<HTMLAnchorElement>(".cr-g");
        if (!g || !e.movementX) return;
        const i = els.indexOf(g);
        const f = clamp(-e.movementX * 1.6, -18, 18);
        kick(bodies[i], f);
        kick(bodies[i - 1], f * 0.45);
        kick(bodies[i + 1], f * 0.45);
      };
      track.addEventListener("pointerover", onOver);
      track.addEventListener("pointerleave", onLeave);
      track.addEventListener("pointermove", onMove);
      cleanups.push(() => {
        track.removeEventListener("pointerover", onOver);
        track.removeEventListener("pointerleave", onLeave);
        track.removeEventListener("pointermove", onMove);
      });
    } else {
      // touch: the garment nearest the rail centre turns
      let pickTimer = 0;
      const pick = () => {
        if (performance.now() < autoUntil) return;
        const c = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best: HTMLAnchorElement | null = null;
        let d = 1e9;
        els.forEach((g) => {
          const r = g.getBoundingClientRect();
          const x = Math.abs(r.left + r.width / 2 - c);
          if (x < d) {
            d = x;
            best = g;
          }
        });
        setOn(best);
      };
      const onTouchScroll = () => {
        window.clearTimeout(pickTimer);
        pickTimer = window.setTimeout(pick, 110);
      };
      track.addEventListener("scroll", onTouchScroll, { passive: true });
      cleanups.push(() => {
        track.removeEventListener("scroll", onTouchScroll);
        window.clearTimeout(pickTimer);
      });
      const mid = els[Math.floor(els.length / 2)];
      if (mid) {
        later(() => {
          centre(mid, false);
          setOn(mid);
          later(() => centre(mid, true), 750);
        }, 300);
      }
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearTimeout(stopTimer);
      window.removeEventListener("resize", sizeAll);
      track.removeEventListener("scroll", onScroll);
      cleanups.forEach((f) => f());
      track.classList.remove("has-on");
      bodies.forEach(release);
      els.forEach((_, j) => registry.delete(start + j));
      bodiesRef.current = [];
      railRef.current = null;
    };
  }, [near, fine, rack.items.length, scene, registry, start]);

  // entrance: garments drop onto the rail one after another and swing to rest
  useEffect(() => {
    if (!near || !seen || droppedRef.current) return;
    droppedRef.current = true;
    if (reduce) return;
    const t0 = performance.now();
    bodiesRef.current.forEach((b, j) => {
      b.hold = t0 + j * 60;
      b.y = -46;
      b.th = (Math.random() * 2 - 1) * 7;
      b.tv = (Math.random() * 2 - 1) * 20;
      wake(b);
    });
  }, [near, seen, reduce]);

  const onGarmentClick = (e: React.MouseEvent<HTMLAnchorElement>, index: number) => {
    // modified clicks (new tab etc.) behave like the plain link they are
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const g = e.currentTarget;
    const rail = railRef.current;
    if (!fine && rail && !g.classList.contains("on")) {
      rail.setOn(g);
      window.setTimeout(() => rail.centre(g, true), 650);
      return;
    }
    onOpenRef.current(index, g);
  };

  return (
    <section ref={sectionRef} id={`cr-rail-${rack.slug}`} aria-label={rack.label}>
      <div className="cr-sign">
        <h2>{rack.label}</h2>
        <small>{rack.items.length} დიზაინი</small>
      </div>
      <div className="cr-track" ref={trackRef}>
        <div className="cr-rail-wrap">
          <div className="cr-rail">
            <img className="l" src="/showroom/rail-left.webp" alt="" />
            <div className="m" />
            <img className="r" src="/showroom/rail-right.webp" alt="" />
          </div>
          {near
            ? rack.items.map((d, j) => {
                const m = mockupFor(d.default_color);
                return (
                  <a
                    key={d.id}
                    ref={(el) => {
                      garmentEls.current[j] = el;
                    }}
                    href={`/design/${d.slug}`}
                    className="cr-g"
                    data-i={start + j}
                    data-m={m}
                    aria-label={d.title_ka}
                    onClick={(e) => onGarmentClick(e, start + j)}
                    onFocus={fine ? (e) => railRef.current?.setOn(e.currentTarget) : undefined}
                  >
                    <div className="cr-swing">
                      <div className="cr-face cr-side">
                        <img src={teeSrc(m, "side")} alt="" draggable={false} />
                      </div>
                      <GarmentFront design={d} scene={scene} loadPrint={seen} className="cr-face cr-front" />
                    </div>
                  </a>
                );
              })
            : // far from view: plain links only, so the rail stays crawlable
              rack.items.map((d) => (
                <a key={d.id} href={`/design/${d.slug}`} className="sr-only">
                  {d.title_ka}
                </a>
              ))}
        </div>
      </div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function CatalogRail() {
  const { setMode } = useAppState();
  const [searchParams] = useSearchParams();
  const [designs, setDesigns] = useState<DesignRow[] | null>(null);
  const [scene, setScene] = useState<ShowroomScene | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const registry = useMemo(() => new Map<number, GarmentHandle>(), []);

  const [reduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [fine] = useState(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  useEffect(() => {
    setRailReducedMotion(reduce);
  }, [reduce]);

  // Same query the catalog grid uses (published designs, newest first).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog_designs is not in the generated types (same cast as the grid)
    (supabase as any)
      .from("catalog_designs")
      .select("id, slug, title_ka, thumbnail_url, print_file_url, category, created_at, default_color")
      .eq("is_published", true)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: DesignRow[] | null }) => {
        if (!cancelled) setDesigns(data ?? []);
      });
    loadScene()
      .then((s) => !cancelled && setScene(s))
      .catch((e) => console.warn("[CatalogRail] showroom.json:", e));
    return () => {
      cancelled = true;
    };
  }, []);

  // One rail per category, in CATEGORIES order; unknown categories after them.
  const racks = useMemo<Rack[]>(() => {
    if (!designs) return [];
    const by = new Map<string, DesignRow[]>();
    for (const d of designs) {
      const k = d.category || "various";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(d);
    }
    const order = [...CATEGORIES.map((c) => c.slug as string), ...[...by.keys()].filter((k) => !CATEGORY_LABEL_BY_SLUG[k])];
    return order.filter((k) => by.has(k)).map((k) => ({ slug: k, label: CATEGORY_LABEL_BY_SLUG[k] ?? k, items: by.get(k)! }));
  }, [designs]);

  const flat = useMemo(() => racks.flatMap((r) => r.items.map((d) => ({ d, rack: r.label }))), [racks]);
  const starts = useMemo(() => {
    let n = 0;
    return racks.map((r) => {
      const s = n;
      n += r.items.length;
      return s;
    });
  }, [racks]);

  // ?category=<slug>: scroll to that rail once the rails are laid out
  const wantedCategory = searchParams.get("category");
  useEffect(() => {
    if (!wantedCategory || !scrollRoot || !scene || racks.length === 0) return;
    const el = document.getElementById(`cr-rail-${wantedCategory}`);
    if (el) {
      const top = el.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop;
      scrollRoot.scrollTo({ top: top - 8 });
    }
  }, [wantedCategory, scrollRoot, scene, racks]);

  // ── Stage ──────────────────────────────────────────────────────────────
  const [cur, setCur] = useState<number | null>(null);
  const [stageOn, setStageOn] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const heroFaceRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const curRef = useRef<number | null>(null);
  const pendingRef = useRef<{ kind: "open"; g: HTMLAnchorElement; wasOn: boolean } | { kind: "step"; d: number } | null>(null);
  // the staged garment swings on its own hook too
  const heroBody = useMemo(
    () =>
      mkBody({
        k: 30,
        c: 2.2,
        render(this: RailBody) {
          const f = heroFaceRef.current;
          if (f) f.style.transform = `rotate(${this.th.toFixed(3)}deg)`;
        },
      }),
    [],
  );

  const fromTo = (g: HTMLAnchorElement): string | null => {
    const front = g.querySelector(".cr-front");
    const hero = heroRef.current;
    if (!front || !hero) return null;
    const a = front.getBoundingClientRect();
    const b = hero.getBoundingClientRect();
    if (!b.width) return null;
    return `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width})`;
  };

  const open = useCallback((i: number, g: HTMLAnchorElement) => {
    pendingRef.current = { kind: "open", g, wasOn: g.classList.contains("on") };
    curRef.current = i;
    setCur(i);
  }, []);

  // after the stage (or the next design) has rendered: fly / slide the hero in
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    const hero = heroRef.current;
    if (!pending || !hero || cur === null) return;
    if (pending.kind === "open") {
      const from = pending.wasOn ? fromTo(pending.g) : null;
      pending.g.classList.add("picked");
      requestAnimationFrame(() => setStageOn(true));
      if (!reduce && from) {
        hero.animate([{ transform: from, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], {
          duration: 620,
          easing: "cubic-bezier(.16,1,.3,1)",
        });
      }
      kick(heroBody, -26, 380);
      closeRef.current?.focus({ preventScroll: true });
    } else {
      if (!reduce) {
        hero.animate([{ opacity: 0, transform: `translateX(${pending.d * 40}px)` }, { opacity: 1, transform: "none" }], {
          duration: 420,
          easing: "cubic-bezier(.16,1,.3,1)",
        });
      }
      kick(heroBody, pending.d * -34, 60);
    }
  }, [cur, reduce, heroBody]);

  const close = useCallback(() => {
    const i = curRef.current;
    if (i === null) return;
    curRef.current = null;
    const h = registry.get(i);
    setStageOn(false);
    const done = () => {
      setCur(null);
      if (!h) return;
      h.el.classList.remove("picked");
      if (fine) h.rail.setOn(null);
      kick(h.body, 30);
      h.el.focus({ preventScroll: true });
    };
    const hero = heroRef.current;
    const to = h && hero ? fromTo(h.el) : null;
    if (reduce || !hero || !to) done();
    else
      hero.animate([{ transform: "none", transformOrigin: "0 0" }, { transform: to, transformOrigin: "0 0" }], {
        duration: 420,
        easing: "cubic-bezier(.5,0,.2,1)",
      }).onfinish = done;
  }, [registry, fine, reduce]);

  const step = useCallback(
    (d: number) => {
      const i = curRef.current;
      if (i === null || flat.length === 0) return;
      registry.get(i)?.el.classList.remove("picked");
      const next = (i + d + flat.length) % flat.length;
      const h = registry.get(next);
      if (h) {
        h.rail.setOn(h.el);
        h.el.classList.add("picked");
        h.rail.track.scrollTo({ left: h.el.offsetLeft + h.el.offsetWidth / 2 - h.rail.track.clientWidth / 2 });
      }
      pendingRef.current = { kind: "step", d };
      curRef.current = next;
      setCur(next);
    },
    [flat.length, registry],
  );

  useEffect(() => {
    if (cur === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, close, step]);

  const markSimpleMode = () => setMode("simple");
  const staged = cur !== null ? flat[cur] : null;
  const stagedMockup = staged ? mockupFor(staged.d.default_color) : "white";
  const stagedDims = scene?.garments[stagedMockup]?.front ?? [648, 950];

  return (
    <div ref={setScrollRoot} className="flex-1 overflow-y-auto cr-scene">
      <header className="cr-head">
        <h1>კატალოგი</h1>
        <p>
          {fine
            ? "მიიტანე კურსორი — შემობრუნდება. დააჭირე — ახლოს ნახავ."
            : "გადაასრიალე — შუაში მოხვედრილი შემობრუნდება. დააჭირე — ახლოს ნახავ."}
        </p>
      </header>

      {!designs || !scene ? (
        <p className="cr-status">იტვირთება…</p>
      ) : racks.length === 0 ? (
        <p className="cr-status">დიზაინები ვერ მოიძებნა</p>
      ) : (
        <main className="cr-wall">
          {racks.map((r, ri) => (
            <RailSection
              key={r.slug}
              rack={r}
              start={starts[ri]}
              scene={scene}
              scrollRoot={scrollRoot}
              fine={fine}
              reduce={reduce}
              registry={registry}
              onOpen={open}
            />
          ))}
        </main>
      )}

      {staged && scene && (
        <div
          className={`cr-stage${stageOn ? " on" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={staged.d.title_ka}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <button ref={closeRef} type="button" className="cr-close" aria-label="დახურვა" onClick={close}>
            დახურვა ✕
          </button>
          <div ref={heroRef} className="cr-hero" style={{ "--ar": `${stagedDims[0]}/${stagedDims[1]}` } as React.CSSProperties}>
            <GarmentFront ref={heroFaceRef} key={staged.d.id} design={staged.d} scene={scene} loadPrint className="cr-face cr-front" />
          </div>
          <div className="cr-panel">
            <div className="cr-tag">{staged.rack}</div>
            <h3>{staged.d.title_ka}</h3>
            <div className="cr-meta">
              <span className="cr-dot" style={{ background: MOCKUPS[stagedMockup].dot }} />
              <span>GILDAN მაისური · {MOCKUPS[stagedMockup].label_ka}</span>
            </div>
            <Link className="cr-cta" to={`/design/${staged.d.slug}`} onClick={markSimpleMode}>
              არჩევა და შეკვეთა →
            </Link>
            <div className="cr-nav">
              <button type="button" onClick={() => step(-1)}>
                ← წინა
              </button>
              <button type="button" onClick={() => step(1)}>
                შემდეგი →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
