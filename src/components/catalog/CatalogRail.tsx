import { forwardRef, memo, startTransition, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAppState } from "@/hooks/useAppState";
import { supabase } from "@/integrations/supabase/client";
import { CATEGORIES, CATEGORY_LABEL_BY_SLUG } from "@/lib/categories";
import { kick, mkBody, release, setRailReducedMotion, wake, type RailBody } from "@/lib/railPhysics";
import { bumpPrint, readyPrint, requestPrint } from "./printLoader";
import "./catalogRail.css";

// /designs default view — the showroom rail, ported from the rail prototype.
//
// One category = one heading + its rails. Garments hang side-on; on a mouse,
// resting on one (120 ms) turns it to face you (spring), shoves its neighbours (ripple),
// and brushing the cursor through the rail pushes the clothes; rails drop in on
// first view. Desktop (fine pointer, > 700 px): no horizontal scrolling — a
// category is split into as many stacked rails as needed so each fits the
// width with room for one turned garment. Phone (≤ 700 px or touch): one
// swipeable rail per category (scrollbar hidden, soft edge fades); scrolling
// swings the clothes by inertia, the garment nearest the centre turns, tapping
// another turns and centres it, tapping the turned one opens it. Opening flies
// the garment to a "stage" with its details and the order button.
//
// Tees hang first, hoodies grouped at the end of a category.
//
// Each garment is a real <a href="/design/:slug"> so the catalog stays
// crawlable; plain clicks are handled here (preventDefault) to turn/open.
// Garments mount within ~1 viewport; prints preload within ~1.5 viewports
// (the first category immediately).
//
// Performance: hover/turn/swing never touch React state — bodies write
// transforms straight to the DOM (no layout reads per frame), each rail row is
// `contain: layout paint`, and the stage is its own component so opening it
// doesn't re-render the rails.

interface DesignRow {
  id: string;
  slug: string;
  title_ka: string;
  thumbnail_url: string | null;
  print_file_url: string;
  category: string | null;
  created_at: string;
  default_color: string | null;
  default_product_id: string | null;
  product: { type: string; display_name_ka: string | null } | null;
}

type PrintBox = { l: number; t: number; w: number; h: number };

interface ShowroomScene {
  printBox: PrintBox;
  /** Per garment: front/side image sizes, optionally its own print box (hoodies). */
  garments: Record<string, { front: [number, number]; side: [number, number]; printBox?: PrintBox }>;
}

// ── Mockups ─────────────────────────────────────────────────────────────────
// Blank garments in public/showroom: tees are tee-<key>-{front,side,shade}.webp,
// hoodies hoodie-<colour>-{front,side,shade}.webp (key "hoodie-<colour>").
// Sizes (and a hoodie's own print box) come from showroom.json. A design's
// default_color (any case) picks the garment; anything unlisted wears white
// (hoodies: white for light colours, black otherwise). New colour on an existing garment = one line in a colour
// map; a new garment = its files + one line in MOCKUPS.
const MOCKUPS = {
  white: { dot: "#f3f2ee", label_ka: "თეთრი", light: true },
  black: { dot: "#1f2023", label_ka: "შავი", light: false },
  navy: { dot: "#202a43", label_ka: "მუქი ლურჯი", light: false },
  gray: { dot: "#9a9a9a", label_ka: "რუხი", light: true },
  green: { dot: "#1f4d2e", label_ka: "მწვანე", light: false },
  red: { dot: "#c8141c", label_ka: "წითელი", light: false },
  yellow: { dot: "#f0c419", label_ka: "ყვითელი", light: true },
  blue: { dot: "#1f4fd1", label_ka: "ლურჯი", light: false },
  "hoodie-black": { dot: "#1f2023", label_ka: "შავი", light: false },
  "hoodie-green": { dot: "#1f4d2e", label_ka: "მწვანე", light: false },
  "hoodie-white": { dot: "#f3f2ee", label_ka: "თეთრი", light: true },
  "hoodie-navy": { dot: "#202a43", label_ka: "მუქი ლურჯი", light: false },
  "hoodie-gray": { dot: "#9a9a9a", label_ka: "რუხი", light: true },
  "hoodie-red": { dot: "#c8141c", label_ka: "წითელი", light: false },
} as const;
type MockupKey = keyof typeof MOCKUPS;

const TEE_BY_COLOR: Record<string, MockupKey> = {
  white: "white",
  black: "black",
  "dark navy": "navy",
  gray: "gray",
  "light gray": "gray",
  "light gray melange": "gray",
  green: "green",
  red: "red",
  burgundy: "red",
  yellow: "yellow",
  "sol's electric": "blue",
  "electric blue": "blue",
  "standard blue": "blue",
  "light blue": "blue",
};

const HOODIE_BY_COLOR: Record<string, MockupKey> = {
  black: "hoodie-black",
  green: "hoodie-green",
  white: "hoodie-white",
  "dark navy": "hoodie-navy",
  gray: "hoodie-gray",
  "light gray": "hoodie-gray",
  "light gray melange": "hoodie-gray",
  red: "hoodie-red",
  burgundy: "hoodie-red",
};

// A hoodie colour with no photo of its own: light colours wear the white
// hoodie, everything else the black one (before, every unknown colour — white
// included — fell to black).
const LIGHT_COLORS = new Set(["beige", "yellow", "light blue", "pink", "khaki", "lime", "orange"]);

/** The design's product row (embedded via the default_product_id FK), if any. */
const productOf = (d: DesignRow) => (Array.isArray(d.product) ? d.product[0] : d.product) ?? null;
const isHoodie = (d: DesignRow) => productOf(d)?.type === "Hoodie";

function mockupFor(d: DesignRow): MockupKey {
  const color = (d.default_color || "").toLowerCase();
  if (isHoodie(d)) return HOODIE_BY_COLOR[color] ?? (LIGHT_COLORS.has(color) ? "hoodie-white" : "hoodie-black");
  return TEE_BY_COLOR[color] ?? "white";
}

const garmentSrc = (m: MockupKey, part: "front" | "side" | "shade") =>
  m.startsWith("hoodie-") ? `/showroom/${m}-${part}.webp` : `/showroom/tee-${m}-${part}.webp`;

const printRaw = (d: DesignRow) => d.thumbnail_url || d.print_file_url;

let scenePromise: Promise<ShowroomScene> | null = null;
function loadScene(): Promise<ShowroomScene> {
  scenePromise ??= fetch("/showroom/showroom.json").then((r) => {
    if (!r.ok) throw new Error(`showroom.json: HTTP ${r.status}`);
    return r.json() as Promise<ShowroomScene>;
  });
  return scenePromise;
}

// ── Slot geometry (shared by the row split and the physics sizing) ──────────
const DESKTOP_H = 300;
const ROW_PAD_X = 52; // .cr-rail-wrap padding-inline on desktop
const ITEM_GAP = 2; // .cr-rail-wrap gap
const HOODIE_GAP = 14; // gap before the hoodie group (incl. ITEM_GAP)
const SLOT_GAP = 8; // air added to every side-on slot so each garment is easy to hit
const HOVER_INTENT_MS = 120; // fine pointer: rest this long on a garment before it turns

interface Geometry {
  /** Width of the side image. */
  side: number;
  /** Slot width while side-on: tees 95 % of the side image, hoodies the full image + 6 px; both + SLOT_GAP. */
  slot: number;
  /** Width while turned to the front. */
  front: number;
}

function geometry(scene: ShowroomScene, m: MockupKey, H: number): Geometry {
  const dims = scene.garments[m] ?? scene.garments.white;
  const [fw, fh] = dims.front;
  const [sw, sh] = dims.side;
  const side = Math.round((sw / sh) * H);
  return {
    side,
    slot: (m.startsWith("hoodie-") ? side + 6 : Math.round((sw / sh) * H * 0.95)) + SLOT_GAP,
    front: Math.round((fw / fh) * H),
  };
}

// ── Prints ──────────────────────────────────────────────────────────────────
function usePrint(raw: string, high = false): string | null {
  const [url, setUrl] = useState<string | null>(() => readyPrint(raw) ?? null);
  useEffect(() => {
    let alive = true;
    const ready = readyPrint(raw);
    if (ready) {
      setUrl(ready);
      return;
    }
    requestPrint(raw, high).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [raw, high]);
  return url;
}

interface FrontProps {
  design: DesignRow;
  scene: ShowroomScene;
  className: string;
  high?: boolean;
}

/** Garment front: blank garment + print (fades in when ready) + shade map. */
const GarmentFront = memo(
  forwardRef<HTMLDivElement, FrontProps>(function GarmentFront({ design, scene, className, high }, ref) {
    const m = mockupFor(design);
    const print = usePrint(printRaw(design), high);
    const B = scene.garments[m]?.printBox ?? scene.printBox;
    const box: React.CSSProperties = { left: `${B.l * 100}%`, top: `${B.t * 100}%`, width: `${B.w * 100}%`, height: `${B.h * 100}%` };
    return (
      <div ref={ref} className={`${className} ${MOCKUPS[m].light ? "cr-light" : "cr-dark"}`}>
        <img src={garmentSrc(m, "front")} alt="" draggable={false} />
        {print && (
          <img
            className="cr-print"
            src={print}
            alt=""
            decoding="async"
            draggable={false}
            style={box}
            onLoad={(e) => e.currentTarget.classList.add("in")}
          />
        )}
        <img className="cr-shade" src={garmentSrc(m, "shade")} alt="" draggable={false} style={box} />
      </div>
    );
  }),
);

// ── Layout: categories → rows ───────────────────────────────────────────────
interface Item {
  d: DesignRow;
  /** Position in the page-wide order (stage prev/next). */
  index: number;
  m: MockupKey;
  hoodie: boolean;
}

interface Rack {
  slug: string;
  label: string;
  items: Item[];
}

/** Rows of one category on desktop: each fits `usable` px with room for one turned garment. */
function splitRows(items: Item[], scene: ShowroomScene, usable: number): Item[][] {
  const g = items.map((it) => geometry(scene, it.m, DESKTOP_H));
  const rowWidth = (from: number, to: number) => {
    let w = 0;
    let extra = 0;
    for (let i = from; i < to; i++) {
      if (i > from) w += !items[i - 1].hoodie && items[i].hoodie ? HOODIE_GAP : ITEM_GAP;
      w += g[i].slot;
      extra = Math.max(extra, Math.ceil(g[i].front * 1.06) - g[i].slot);
    }
    return w + extra;
  };
  // greedy: as many per row as fit
  const greedy: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= items.length; i++) {
    if (i === items.length || rowWidth(start, i + 1) > usable) {
      greedy.push([start, i]);
      start = i;
    }
  }
  if (greedy.length <= 1) return greedy.map(([a, b]) => items.slice(a, b));
  // then even the rows out (same count), so the last one isn't a stub
  const n = greedy.length;
  const target = rowWidth(0, items.length) / n;
  const rows: [number, number][] = [];
  start = 0;
  for (let i = 1; i <= items.length; i++) {
    const left = n - rows.length;
    const mustBreak = i < items.length && (rowWidth(start, i + 1) > usable || (left > 1 && rowWidth(start, i + 1) > target * 1.02));
    if (i === items.length || (mustBreak && left > 1)) {
      rows.push([start, i]);
      start = i;
    }
  }
  const ok = rows.length === n && rows.every(([a, b]) => rowWidth(a, b) <= usable);
  return (ok ? rows : greedy).map(([a, b]) => items.slice(a, b));
}

// ── Rails ───────────────────────────────────────────────────────────────────
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

type Registry = Map<number, GarmentHandle>;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface RowProps {
  items: Item[];
  scene: ShowroomScene;
  desktop: boolean;
  fine: boolean;
  reduce: boolean;
  /** Section is within ~1 viewport (garments mounted) / has been seen (drop in). */
  near: boolean;
  seen: boolean;
  /** Stagger offset for the entrance drop (garments before this row in the section). */
  dropOffset: number;
  registry: Registry;
  onOpen: (index: number, el: HTMLAnchorElement) => void;
}

const RailRow = memo(function RailRow({ items, scene, desktop, fine, reduce, near, seen, dropOffset, registry, onOpen }: RowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const garmentEls = useRef<(HTMLAnchorElement | null)[]>([]);
  const bodiesRef = useRef<RailBody[]>([]);
  const railRef = useRef<RailApi | null>(null);
  const droppedRef = useRef(false);

  // Bodies, sizing and the rail's interactions, while the garments are mounted.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!near || !track) return;
    const els = garmentEls.current.slice(0, items.length).filter((g): g is HTMLAnchorElement => !!g);
    const index = new Map<HTMLAnchorElement, number>(els.map((g, j) => [g, j]));
    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));

    // cached per garment: the nodes it writes to and its widths
    const parts = els.map((g) => ({
      sh: g.querySelector<HTMLElement>(".cr-shadow")!,
      sw: g.querySelector<HTMLElement>(".cr-swing")!,
      sd: g.querySelector<HTMLElement>(".cr-side")!,
      fr: g.querySelector<HTMLElement>(".cr-front")!,
      swW: 0,
      fwW: 0,
    }));
    const bodies = els.map((g, j) => {
      const P = parts[j];
      const b = mkBody({
        render(t: number) {
          const p = Math.max(0, b.p);
          const q = Math.min(p, 1);
          g.style.width = (P.swW + (P.fwW - P.swW) * Math.min(p, 1.06)).toFixed(1) + "px";
          const ang = p * 180;
          if (ang < 90) {
            P.sd.style.opacity = "1";
            P.fr.style.opacity = "0";
            P.sd.style.transform = `translateX(-50%) rotateY(${ang.toFixed(2)}deg)`;
          } else {
            P.sd.style.opacity = "0";
            P.fr.style.opacity = "1";
            P.fr.style.transform = `translateX(-50%) translateY(${(7 * q).toFixed(2)}px) scale(${(1 + 0.08 * Math.min(p, 1.15)).toFixed(4)}) rotateY(${(ang - 180).toFixed(2)}deg)`;
          }
          const lift = -10 * Math.sin(Math.PI * clamp(b.p, 0, 1));
          P.sw.style.transform = `translateY(${(b.y + lift).toFixed(2)}px) rotate(${b.th.toFixed(3)}deg)`;
          const held = b.hold && t < b.hold;
          P.sw.style.opacity = held ? "0" : "1";
          // shadow: faint behind the side view, full once facing you; gone while dropping in
          P.sh.style.opacity = held ? "0" : ((0.4 + 0.6 * q) * clamp(1 - Math.abs(b.y) / 60, 0, 1)).toFixed(3);
        },
        // compositor layers only while moving
        onWake: () => {
          P.sw.style.willChange = "transform";
        },
        onSleep: () => {
          P.sw.style.willChange = "";
        },
      });
      return b;
    });
    bodiesRef.current = bodies;

    const sizeAll = () => {
      const H = parseFloat(getComputedStyle(track).getPropertyValue("--H")) || DESKTOP_H;
      els.forEach((g, j) => {
        const geo = geometry(scene, items[j].m, H);
        parts[j].swW = geo.slot;
        parts[j].fwW = geo.front;
        parts[j].sd.style.width = geo.side + "px";
        parts[j].fr.style.width = geo.front + "px";
        bodies[j].render(0);
      });
    };
    sizeAll();
    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(sizeAll, 150);
    };
    window.addEventListener("resize", onResize);

    // turning one garment: it springs round, its neighbours get shoved and swing
    let onEl: HTMLAnchorElement | null = null;
    // hover intent (fine pointer): the garment waiting out HOVER_INTENT_MS
    let intentEl: HTMLAnchorElement | null = null;
    let intentTimer = 0;
    const cancelIntent = () => {
      window.clearTimeout(intentTimer);
      intentEl = null;
    };
    const setOn = (g: HTMLAnchorElement | null) => {
      cancelIntent();
      const prev = onEl;
      if (prev === g) return;
      if (prev) {
        prev.classList.remove("on");
        const pb = bodies[index.get(prev) ?? -1];
        if (pb) {
          pb.pt = 0;
          wake(pb);
          kick(pb, (Math.random() < 0.5 ? 1 : -1) * 22, 60);
        }
      }
      onEl = g;
      if (!g) return;
      g.classList.add("on");
      const i = index.get(g) ?? -1;
      const b = bodies[i];
      if (!b) return;
      // its print is needed now
      const raw = g.dataset.print;
      if (raw) bumpPrint(raw);
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
    els.forEach((el, j) => registry.set(items[j].index, { el, body: bodies[j], rail }));

    const cleanups: (() => void)[] = [];
    if (!desktop) {
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
      cleanups.push(() => {
        track.removeEventListener("scroll", onScroll);
        window.clearTimeout(stopTimer);
      });
    }
    if (fine) {
      const garmentOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLAnchorElement>(".cr-g") : null);
      // hover intent: a garment turns only once the cursor has rested on it for
      // HOVER_INTENT_MS; passing over (or leaving) sooner cancels, so sweeping
      // across the rail doesn't spin and ripple every garment on the way
      const onOver = (e: PointerEvent) => {
        const g = garmentOf(e.target);
        if (!g || !index.has(g)) {
          cancelIntent();
          return;
        }
        if (g === intentEl) return; // moved between the garment's own children
        cancelIntent();
        if (g === onEl) return;
        intentEl = g;
        intentTimer = window.setTimeout(() => setOn(g), HOVER_INTENT_MS);
      };
      const onLeave = () => setOn(null);
      // a press opens the garment as it is: don't turn it underneath the stage
      const onDown = () => cancelIntent();
      // brushing: running the cursor through the rail pushes the clothes it passes
      const onMove = (e: PointerEvent) => {
        if (!e.movementX) return;
        const i = index.get(garmentOf(e.target) as HTMLAnchorElement) ?? -1;
        if (i < 0) return;
        const f = clamp(-e.movementX * 1.6, -18, 18);
        kick(bodies[i], f);
        kick(bodies[i - 1], f * 0.45);
        kick(bodies[i + 1], f * 0.45);
      };
      track.addEventListener("pointerover", onOver);
      track.addEventListener("pointerleave", onLeave);
      track.addEventListener("pointermove", onMove);
      track.addEventListener("pointerdown", onDown);
      cleanups.push(() => {
        track.removeEventListener("pointerover", onOver);
        track.removeEventListener("pointerleave", onLeave);
        track.removeEventListener("pointermove", onMove);
        track.removeEventListener("pointerdown", onDown);
        cancelIntent();
      });
    } else {
      // touch: the garment nearest the rail centre turns (centres from cached offsets)
      let pickTimer = 0;
      const pick = () => {
        if (performance.now() < autoUntil) return;
        const c = track.scrollLeft + track.clientWidth / 2;
        let best: HTMLAnchorElement | null = null;
        let d = 1e9;
        for (const g of els) {
          const x = Math.abs(g.offsetLeft + g.offsetWidth / 2 - c);
          if (x < d) {
            d = x;
            best = g;
          }
        }
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
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      cleanups.forEach((f) => f());
      bodies.forEach(release);
      items.forEach((it) => {
        if (registry.get(it.index)?.rail === rail) registry.delete(it.index);
      });
      bodiesRef.current = [];
      railRef.current = null;
    };
  }, [near, fine, desktop, items, scene, registry]);

  // entrance: garments drop onto the rail one after another and swing to rest
  useEffect(() => {
    if (!near || !seen || droppedRef.current) return;
    droppedRef.current = true;
    if (reduce) return;
    const t0 = performance.now();
    bodiesRef.current.forEach((b, j) => {
      b.hold = t0 + (dropOffset + j) * 60;
      b.y = -46;
      b.th = (Math.random() * 2 - 1) * 7;
      b.tv = (Math.random() * 2 - 1) * 20;
      wake(b);
    });
  }, [near, seen, reduce, dropOffset]);

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
    onOpen(index, g);
  };

  return (
    <div className={`cr-track${desktop ? " cr-track--fit" : " cr-track--swipe"}`} ref={trackRef}>
      <div className="cr-rail-wrap">
        <div className="cr-rail">
          <img className="l" src="/showroom/rail-left.webp" alt="" />
          <div className="m" />
          <img className="r" src="/showroom/rail-right.webp" alt="" />
        </div>
        {near
          ? items.map((it, j) => (
              <a
                key={it.d.id}
                ref={(el) => {
                  garmentEls.current[j] = el;
                }}
                href={`/design/${it.d.slug}`}
                className={`cr-g${it.hoodie ? " cr-hoodie" : ""}${it.hoodie && j > 0 && !items[j - 1].hoodie ? " cr-hoodie-first" : ""}`}
                data-i={it.index}
                data-print={printRaw(it.d)}
                aria-label={it.d.title_ka}
                onClick={(e) => onGarmentClick(e, it.index)}
                onFocus={fine ? (e) => railRef.current?.setOn(e.currentTarget) : undefined}
              >
                <div className="cr-shadow" />
                <div className="cr-swing">
                  <div className="cr-face cr-side">
                    <img src={garmentSrc(it.m, "side")} alt="" draggable={false} />
                  </div>
                  <GarmentFront design={it.d} scene={scene} className="cr-face cr-front" />
                </div>
              </a>
            ))
          : // far from view: plain links only, so the rail stays crawlable
            items.map((it) => (
              <a key={it.d.id} href={`/design/${it.d.slug}`} className="sr-only">
                {it.d.title_ka}
              </a>
            ))}
      </div>
    </div>
  );
});

interface SectionProps {
  rack: Rack;
  rows: Item[][];
  first: boolean;
  scene: ShowroomScene;
  scrollRoot: HTMLElement | null;
  desktop: boolean;
  fine: boolean;
  reduce: boolean;
  registry: Registry;
  onOpen: (index: number, el: HTMLAnchorElement) => void;
}

const CategorySection = memo(function CategorySection({ rack, rows, first, scene, scrollRoot, desktop, fine, reduce, registry, onOpen }: SectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [preload, setPreload] = useState(first);
  const [seen, setSeen] = useState(false);

  // mount within ~1 viewport, preload prints within ~1.5, drop in once 20 % visible
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !scrollRoot) return;
    // a transition: mounting a rail's garments is time-sliced instead of one long task mid-scroll
    const nearIo = new IntersectionObserver(([e]) => startTransition(() => setNear(e.isIntersecting)), {
      root: scrollRoot,
      rootMargin: "100% 0px",
    });
    const preIo = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setPreload(true);
          preIo.disconnect();
        }
      },
      { root: scrollRoot, rootMargin: "150% 0px" },
    );
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
    preIo.observe(section);
    seenIo.observe(section);
    return () => {
      nearIo.disconnect();
      preIo.disconnect();
      seenIo.disconnect();
    };
  }, [scrollRoot]);

  useEffect(() => {
    if (preload) rack.items.forEach((it) => void requestPrint(printRaw(it.d)));
  }, [preload, rack.items]);

  let offset = 0;
  return (
    <section ref={sectionRef} id={`cr-rail-${rack.slug}`} aria-label={rack.label} className="cr-cat">
      <div className="cr-sign">
        <h2>{rack.label}</h2>
        <small>{rack.items.length} დიზაინი</small>
      </div>
      <div className="cr-rows">
        {rows.map((row) => {
          const dropOffset = offset;
          offset += row.length;
          return (
            <RailRow
              key={row[0].d.id}
              items={row}
              scene={scene}
              desktop={desktop}
              fine={fine}
              reduce={reduce}
              near={near}
              seen={seen}
              dropOffset={dropOffset}
              registry={registry}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </section>
  );
});

// ── Stage ───────────────────────────────────────────────────────────────────
interface StageApi {
  open: (index: number, el: HTMLAnchorElement) => void;
}

interface StageProps {
  flat: { d: DesignRow; rack: string }[];
  scene: ShowroomScene;
  registry: Registry;
  fine: boolean;
  reduce: boolean;
}

const Stage = forwardRef<StageApi, StageProps>(function Stage({ flat, scene, registry, fine, reduce }, ref) {
  const { setMode } = useAppState();
  const [cur, setCur] = useState<number | null>(null);
  const [on, setOn] = useState(false);
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

  /** FLIP "from" transform: the garment's front face relative to the hero box (one layout read). */
  const fromTo = (g: HTMLAnchorElement): string | null => {
    const front = g.querySelector(".cr-front");
    const hero = heroRef.current;
    if (!front || !hero) return null;
    const a = front.getBoundingClientRect();
    const b = hero.getBoundingClientRect();
    if (!b.width) return null;
    return `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width})`;
  };

  useImperativeHandle(
    ref,
    () => ({
      open(i, g) {
        pendingRef.current = { kind: "open", g, wasOn: g.classList.contains("on") };
        curRef.current = i;
        setCur(i);
      },
    }),
    [],
  );

  // after the stage (or the next design) has rendered: fly / slide the hero in
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    const hero = heroRef.current;
    if (!pending || !hero || cur === null) return;
    if (pending.kind === "open") {
      const from = pending.wasOn ? fromTo(pending.g) : null;
      pending.g.classList.add("picked");
      requestAnimationFrame(() => setOn(true));
      if (!reduce && from) {
        hero.animate(
          [
            { transform: from, transformOrigin: "0 0", opacity: 1 },
            { transform: "none", transformOrigin: "0 0", opacity: 1 },
          ],
          { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" },
        );
      } else if (!reduce) {
        hero.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
      }
      kick(heroBody, -26, 380);
      closeRef.current?.focus({ preventScroll: true });
    } else {
      if (!reduce) {
        hero.animate([{ opacity: 0, transform: `translateX(${pending.d * 40}px)` }, { opacity: 1, transform: "none" }], {
          duration: 380,
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
    setOn(false);
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
    if (reduce || !hero) done();
    else
      hero.animate(
        to
          ? [
              { transform: "none", transformOrigin: "0 0", opacity: 1 },
              { transform: to, transformOrigin: "0 0", opacity: 1 },
            ]
          : [{ opacity: 1 }, { opacity: 0 }],
        { duration: 360, easing: "cubic-bezier(.5,0,.2,1)" },
      ).onfinish = done;
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
        if (h.rail.track.scrollWidth > h.rail.track.clientWidth) {
          h.rail.track.scrollTo({ left: h.el.offsetLeft + h.el.offsetWidth / 2 - h.rail.track.clientWidth / 2 });
        }
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

  const staged = cur !== null ? flat[cur] : null;
  if (!staged) return null;
  const m: MockupKey = mockupFor(staged.d);
  const dims = scene.garments[m]?.front ?? [648, 950];
  return (
    <div
      className={`cr-stage${on ? " on" : ""}`}
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
      <div ref={heroRef} className="cr-hero" style={{ "--ar": `${dims[0]}/${dims[1]}` } as React.CSSProperties}>
        <GarmentFront ref={heroFaceRef} key={staged.d.id} design={staged.d} scene={scene} className="cr-face cr-front" high />
      </div>
      <div className="cr-panel">
        <div className="cr-tag">{staged.rack}</div>
        <h3>{staged.d.title_ka}</h3>
        <div className="cr-meta">
          <span className="cr-dot" style={{ background: MOCKUPS[m].dot }} />
          <span>
            {productOf(staged.d)?.display_name_ka || "GILDAN მაისური"} · {MOCKUPS[m].label_ka}
          </span>
        </div>
        <Link className="cr-cta" to={`/design/${staged.d.slug}`} onClick={() => setMode("simple")}>
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
  );
});

// ── Page ────────────────────────────────────────────────────────────────────
const isDesktopNow = (fine: boolean) => fine && window.innerWidth > 700;

export default function CatalogRail() {
  const [searchParams] = useSearchParams();
  const [designs, setDesigns] = useState<DesignRow[] | null>(null);
  const [scene, setScene] = useState<ShowroomScene | null>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const [wall, setWall] = useState<HTMLElement | null>(null);
  const [wallWidth, setWallWidth] = useState(0);
  const registry = useMemo<Registry>(() => new Map(), []);
  const stageRef = useRef<StageApi>(null);

  const [reduce] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [fine] = useState(() => window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  const [desktop, setDesktop] = useState(() => isDesktopNow(fine));
  useEffect(() => {
    setRailReducedMotion(reduce);
  }, [reduce]);

  // The catalog grid's query (published designs, newest first), plus the
  // design's default product (hoodie mockups, stage label).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- catalog_designs is not in the generated types (same cast as the grid)
    (supabase as any)
      .from("catalog_designs")
      .select(
        "id, slug, title_ka, thumbnail_url, print_file_url, category, created_at, default_color, default_product_id, product:products!catalog_designs_default_product_id_fkey(type, display_name_ka)",
      )
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

  // Desktop/phone mode and the wall width (rows are re-split on resize, debounced).
  useEffect(() => {
    if (!wall) return;
    let timer = 0;
    const measure = () => {
      setDesktop(isDesktopNow(fine));
      setWallWidth(wall.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 150);
    });
    ro.observe(wall);
    return () => {
      ro.disconnect();
      window.clearTimeout(timer);
    };
  }, [wall, fine]);

  // One category per rack, in CATEGORIES order (unknown categories after them);
  // within a category tees first, hoodies grouped at the end.
  const racks = useMemo<Rack[]>(() => {
    if (!designs) return [];
    const by = new Map<string, DesignRow[]>();
    for (const d of designs) {
      const k = d.category || "various";
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(d);
    }
    const order = [...CATEGORIES.map((c) => c.slug as string), ...[...by.keys()].filter((k) => !CATEGORY_LABEL_BY_SLUG[k])];
    let index = 0;
    return order
      .filter((k) => by.has(k))
      .map((k) => {
        const ds = by.get(k)!;
        const sorted = [...ds.filter((d) => !isHoodie(d)), ...ds.filter(isHoodie)];
        return {
          slug: k,
          label: CATEGORY_LABEL_BY_SLUG[k] ?? k,
          items: sorted.map((d) => ({ d, index: index++, m: mockupFor(d), hoodie: isHoodie(d) })),
        };
      });
  }, [designs]);

  const flat = useMemo(() => racks.flatMap((r) => r.items.map((it) => ({ d: it.d, rack: r.label }))), [racks]);

  const rowsByRack = useMemo(() => {
    if (!scene) return [];
    return racks.map((r) => (desktop && wallWidth > 0 ? splitRows(r.items, scene, wallWidth - 2 * ROW_PAD_X) : [r.items]));
  }, [racks, scene, desktop, wallWidth]);

  // ?category=<slug>: scroll to that category once the rails are laid out
  const wantedCategory = searchParams.get("category");
  useEffect(() => {
    if (!wantedCategory || !scrollRoot || !scene || racks.length === 0) return;
    const el = document.getElementById(`cr-rail-${wantedCategory}`);
    if (el) {
      const top = el.getBoundingClientRect().top - scrollRoot.getBoundingClientRect().top + scrollRoot.scrollTop;
      scrollRoot.scrollTo({ top: top - 8 });
    }
  }, [wantedCategory, scrollRoot, scene, racks]);

  const open = useCallback((i: number, g: HTMLAnchorElement) => stageRef.current?.open(i, g), []);

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
        <main ref={setWall} className="cr-wall">
          {racks.map((r, ri) => (
            <CategorySection
              key={r.slug}
              rack={r}
              rows={rowsByRack[ri] ?? [r.items]}
              first={ri === 0}
              scene={scene}
              scrollRoot={scrollRoot}
              desktop={desktop}
              fine={fine}
              reduce={reduce}
              registry={registry}
              onOpen={open}
            />
          ))}
        </main>
      )}

      {scene && <Stage ref={stageRef} flat={flat} scene={scene} registry={registry} fine={fine} reduce={reduce} />}
    </div>
  );
}
