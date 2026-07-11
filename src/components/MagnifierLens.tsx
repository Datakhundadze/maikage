import { useRef, useState, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

// Circular magnifier ("ლუპა") overlay. Wraps a display element and, while
// active, shows a round lens that magnifies `zoomSrc` at the pointer position
// using CSS background-position math — zero dependencies.
//
// Pure display: it renders `children` (the composited preview) untouched and
// draws the lens on top. `zoomSrc` should be a HI-RES version of what
// `children` shows so the magnified crop stays crisp; when it's null (still
// loading) the lens is suppressed.
//
// Desktop: the parent toggles `active`; the lens follows the cursor on hover.
// Mobile: press-and-hold shows the lens at the touch point and it tracks the
// drag; releasing hides it. Touch-action none + preventDefault suppress the
// browser's text-selection / context-menu / scroll during a hold.

const LENS_SIZE = 150; // diameter in px
const ZOOM = 2.5;

interface MagnifierLensProps {
  /** Whether the magnifier is enabled (desktop toggle). Touch hold works
   *  regardless once enabled. */
  active: boolean;
  /** Hi-res image the lens magnifies. null → lens hidden (e.g. still building). */
  zoomSrc: string | null;
  children: React.ReactNode;
}

export default function MagnifierLens({ active, zoomSrc, children }: MagnifierLensProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Lens center in container-local px, or null when hidden.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const updateFromEvent = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // Ignore positions outside the box (can happen on fast pointer exit).
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) { setPos(null); return; }
    setSize({ w: rect.width, h: rect.height });
    setPos({ x, y });
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || !zoomSrc) return;
    // Mouse: hover-follow. Touch/pen: only while pressed (buttons or a captured
    // hold). e.pressure > 0 / buttons handles the "held" case; for touch we
    // additionally gate on the element having captured the pointer.
    if (e.pointerType !== "mouse" && e.buttons === 0) return;
    if (e.pointerType !== "mouse") e.preventDefault();
    updateFromEvent(e);
  }, [active, zoomSrc, updateFromEvent]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || !zoomSrc) return;
    // Press-and-hold on touch/pen: capture so we keep receiving moves and
    // suppress the native long-press context menu / selection.
    if (e.pointerType !== "mouse") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    updateFromEvent(e);
  }, [active, zoomSrc, updateFromEvent]);

  const hide = useCallback(() => setPos(null), []);

  const show = pos && active && zoomSrc;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      style={active ? { touchAction: "none", cursor: show ? "none" : "crosshair" } : undefined}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={hide}
      onPointerCancel={hide}
      onPointerLeave={hide}
      onContextMenu={(e) => { if (active) e.preventDefault(); }}
    >
      {children}
      {show && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-white shadow-lg ring-1 ring-black/20 z-20"
          style={{
            width: LENS_SIZE,
            height: LENS_SIZE,
            left: pos!.x - LENS_SIZE / 2,
            top: pos!.y - LENS_SIZE / 2,
            backgroundImage: `url(${zoomSrc})`,
            backgroundRepeat: "no-repeat",
            // The display image is object-contain within the box; the composited
            // mockups are square and the box is square (aspect-square), so a
            // straight box→zoom scale keeps the crop aligned.
            backgroundSize: `${size.w * ZOOM}px ${size.h * ZOOM}px`,
            backgroundPosition: `${-(pos!.x * ZOOM - LENS_SIZE / 2)}px ${-(pos!.y * ZOOM - LENS_SIZE / 2)}px`,
          }}
        />
      )}
    </div>
  );
}
