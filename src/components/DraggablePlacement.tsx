import { useRef, useCallback, useState, type ReactNode } from "react";
import type { PlacementCoords } from "@/lib/catalog";
import { RotateCw } from "lucide-react";

// Floor and ceiling for the design-layer scale relative to the placement
// zone. 0.1 keeps the layer from collapsing to invisible; 3 lets the user
// grow the layer well past the printable zone so long text has room — the
// composite still clips to the zone so the extra space is editor-only.
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

/**
 * Crop / pan state for a photo's source image, independent of the window box.
 *
 * - `scale`: source width in zone-X-fractions (absolute, matches `coords.scale` units).
 * - `offsetX`/`offsetY`: source center offset from the window center, in zone fractions.
 *
 * When present, the edge handles become *crop* affordances: they change the
 * window dimensions but don't touch the source, so the source pixel content
 * stays put and only more / less of it is visible. The corner handles scale
 * both the window and the source uniformly so the visible image continues to
 * fill the box at the same aspect.
 *
 * When absent (legacy photos / text layers), edges still do 1-axis resize and
 * corners do free 2-axis resize as before.
 */
export interface SourceState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface DraggablePlacementProps {
  coords: PlacementCoords;
  onCoordsChange: (coords: PlacementCoords) => void;
  children?: ReactNode;
  disabled?: boolean;
  accentClass?: string;
  borderClass?: string;
  hideReadout?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  /**
   * Printable zone this layer lives inside (in parent-container coordinates).
   * When set, `coords.x/y/scale` are interpreted relative to this zone, matching
   * the composite canvas. Without a zone, coords are relative to the full parent.
   */
  zone?: PlacementCoords;
  /**
   * Lock the corner-drag resize to this aspect ratio (width / height of the
   * source content). When set, corner drag is proportional — both `scale`
   * and `scaleY` change together so the displayed box keeps this aspect.
   * Text layers omit this so they can still be stretched on either axis.
   */
  aspectLock?: number;
  /** Current source state. Pass alongside `onSourceChange` to enable crop. */
  source?: SourceState;
  onSourceChange?: (s: SourceState) => void;
}

type DragMode =
  | "move"
  | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br"
  | "resize-t" | "resize-b" | "resize-l" | "resize-r"
  | "rotate"
  | null;

export default function DraggablePlacement({
  coords,
  onCoordsChange,
  children,
  disabled,
  accentClass,
  borderClass,
  hideReadout,
  selected,
  onSelect,
  zone,
  aspectLock,
  source,
  onSourceChange,
}: DraggablePlacementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  // Drag start cache includes the source state so multi-update drags (corner
  // proportional resize) can derive new values from the start state rather
  // than the in-flight update. `altKey` is snapshotted on pointerDown so
  // a center-drag that began with Alt held continues panning even if the
  // user lets go of Alt mid-gesture.
  const startRef = useRef({
    mx: 0, my: 0,
    cx: 0, cy: 0, cs: 0, csY: 0,
    startAngle: 0, startRotation: 0,
    srcScale: 0, srcOffsetX: 0, srcOffsetY: 0,
    altKey: false,
  });

  // Zone geometry in parent coordinates (fractions 0-1)
  const zoneW = zone?.scale ?? 1;
  const zoneH = zone?.scaleY ?? zone?.scale ?? 1;
  const zoneCx = zone?.x ?? 0.5;
  const zoneCy = zone?.y ?? 0.5;
  const zoneLeft = zoneCx - zoneW / 2;
  const zoneTop = zoneCy - zoneH / 2;

  const getCenterPoint = useCallback(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return { cx: 0, cy: 0 };
    const rect = parent.getBoundingClientRect();
    // Photo center in parent coords = zone origin + coords * zone size
    const cxFrac = zoneLeft + coords.x * zoneW;
    const cyFrac = zoneTop + coords.y * zoneH;
    return { cx: rect.left + cxFrac * rect.width, cy: rect.top + cyFrac * rect.height };
  }, [coords.x, coords.y, zoneLeft, zoneTop, zoneW, zoneH]);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragMode(mode);

    const srcSnapshot = {
      srcScale: source?.scale ?? 0,
      srcOffsetX: source?.offsetX ?? 0,
      srcOffsetY: source?.offsetY ?? 0,
      altKey: e.altKey,
    };
    if (mode === "rotate") {
      const center = getCenterPoint();
      const startAngle = Math.atan2(e.clientY - center.cy, e.clientX - center.cx);
      startRef.current = {
        mx: e.clientX, my: e.clientY,
        cx: coords.x, cy: coords.y,
        cs: coords.scale, csY: coords.scaleY ?? coords.scale,
        startAngle,
        startRotation: coords.rotation ?? 0,
        ...srcSnapshot,
      };
    } else {
      startRef.current = {
        mx: e.clientX, my: e.clientY,
        cx: coords.x, cy: coords.y,
        cs: coords.scale, csY: coords.scaleY ?? coords.scale,
        startAngle: 0, startRotation: 0,
        ...srcSnapshot,
      };
    }
  }, [disabled, coords, source, getCenterPoint, onSelect]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragMode || !containerRef.current) return;
    const parent = containerRef.current.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();

    if (dragMode === "rotate") {
      const center = getCenterPoint();
      const currentAngle = Math.atan2(e.clientY - center.cy, e.clientX - center.cx);
      const deltaAngle = (currentAngle - startRef.current.startAngle) * (180 / Math.PI);
      let newRotation = startRef.current.startRotation + deltaAngle;
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;
      onCoordsChange({ ...coords, rotation: Math.round(newRotation) });
      return;
    }

    // Convert pointer delta to ZONE-relative fractions so drag feels consistent
    // regardless of how small the print area is on the product.
    const dx = (e.clientX - startRef.current.mx) / (rect.width * zoneW);
    const dy = (e.clientY - startRef.current.my) / (rect.height * zoneH);

    if (dragMode === "move") {
      // Alt-drag on the center pans the source within the window instead
      // of moving the window itself — useful for repositioning a tightly
      // cropped photo's visible region without disturbing the layout.
      // Falls through to the normal move when there's no source state to
      // pan (text layer or photo without naturalAspect yet).
      if (startRef.current.altKey && source && onSourceChange) {
        onSourceChange({
          scale: startRef.current.srcScale,
          offsetX: startRef.current.srcOffsetX + dx,
          offsetY: startRef.current.srcOffsetY + dy,
        });
        return;
      }
      // No clamp on move: the design centre can go anywhere on the preview
      // (or even slightly off it). The outer preview container is
      // overflow-hidden so off-canvas movement is harmless visually.
      // Source state stays unchanged — `offsetX/Y` are relative to the
      // window center, so the source absolute position naturally tracks
      // the window when the window moves.
      onCoordsChange({
        ...coords,
        x: startRef.current.cx + dx,
        y: startRef.current.cy + dy,
      });
    } else if (dragMode === "resize-t" || dragMode === "resize-b" || dragMode === "resize-l" || dragMode === "resize-r") {
      // Edge handle: one-axis resize, with the opposite edge anchored so
      // the box only grows/shrinks in the direction the user drags. The
      // anchored edge stays fixed even though we store the box by its
      // center, so the center has to shift by half the size change.
      //
      // Crop semantics: when source state is supplied the source image
      // stays absolute (the visible content doesn't shift) by adjusting
      // the source offset inversely to the window center shift. The
      // window simply reveals more or less of the same source pixels.
      const clamp = (v: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));
      let newScale = startRef.current.cs;
      let newScaleY = startRef.current.csY;
      let newX = startRef.current.cx;
      let newY = startRef.current.cy;
      if (dragMode === "resize-t") {
        newScaleY = clamp(startRef.current.csY - dy);
        const anchorBottom = startRef.current.cy + startRef.current.csY / 2;
        newY = anchorBottom - newScaleY / 2;
      } else if (dragMode === "resize-b") {
        newScaleY = clamp(startRef.current.csY + dy);
        const anchorTop = startRef.current.cy - startRef.current.csY / 2;
        newY = anchorTop + newScaleY / 2;
      } else if (dragMode === "resize-l") {
        newScale = clamp(startRef.current.cs - dx);
        const anchorRight = startRef.current.cx + startRef.current.cs / 2;
        newX = anchorRight - newScale / 2;
      } else {
        newScale = clamp(startRef.current.cs + dx);
        const anchorLeft = startRef.current.cx - startRef.current.cs / 2;
        newX = anchorLeft + newScale / 2;
      }
      onCoordsChange({ ...coords, x: newX, y: newY, scale: newScale, scaleY: newScaleY });
      if (source && onSourceChange) {
        // Window shifted by (newX - oldX, newY - oldY). Compensate the
        // source offset by the negative of that shift so the source's
        // absolute position (coords.x + offsetX) stays put.
        const shiftX = newX - startRef.current.cx;
        const shiftY = newY - startRef.current.cy;
        onSourceChange({
          scale: startRef.current.srcScale,
          offsetX: startRef.current.srcOffsetX - shiftX,
          offsetY: startRef.current.srcOffsetY - shiftY,
        });
      }
    } else {
      // Corner handle: two-axis resize.
      //  - Without aspectLock (text layers): free, both axes independent.
      //  - With aspectLock (photo layers): proportional, locked to the
      //    source image's natural aspect ratio so dragging a corner
      //    doesn't stretch the image content.
      const isLeft = dragMode.includes("l");
      const isTop = dragMode.includes("t");
      const sdx = isLeft ? -dx : dx;
      const sdy = isTop ? -dy : dy;
      const clamp = (v: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, v));
      // Compute the new window scale + position, then (if source state is
      // attached) scale the source proportionally around the same anchor
      // corner so the visible image grows / shrinks with the window
      // rather than just exposing more transparent space.
      let newScale: number;
      let newScaleY: number;
      if (aspectLock && aspectLock > 0) {
        // The box's effective pixel aspect must equal aspectLock for the
        // photo not to stretch:
        //   (scale * zoneW) / (scaleY * zoneH) = aspectLock
        //   → scaleY = scale * zoneW / (aspectLock * zoneH)
        const aspectFactor = zoneW / (aspectLock * zoneH);
        const dxPx = Math.abs(dx * zoneW);
        const dyPx = Math.abs(dy * zoneH);
        if (dxPx >= dyPx) {
          const rawScale = clamp(startRef.current.cs + sdx * 2);
          newScaleY = clamp(rawScale * aspectFactor);
          newScale = newScaleY / aspectFactor;
        } else {
          newScaleY = clamp(startRef.current.csY + sdy * 2);
          newScale = clamp(newScaleY / aspectFactor);
          newScaleY = newScale * aspectFactor;
        }
      } else {
        newScale = clamp(startRef.current.cs + sdx * 2);
        newScaleY = clamp(startRef.current.csY + sdy * 2);
      }
      // Anchor the OPPOSITE corner of the dragged one so the box grows
      // away from a fixed point.
      const signX = isLeft ? 1 : -1;   // +1 means anchor is to the RIGHT of center (and source/window grow LEFT)
      const signY = isTop ? 1 : -1;
      const anchorX = startRef.current.cx + signX * startRef.current.cs / 2;
      const anchorY = startRef.current.cy + signY * startRef.current.csY / 2;
      const newX = anchorX - signX * newScale / 2;
      const newY = anchorY - signY * newScaleY / 2;
      onCoordsChange({ ...coords, x: newX, y: newY, scale: newScale, scaleY: newScaleY });
      if (source && onSourceChange) {
        // Source scales by the same factor around the same anchor; the
        // derived offset and scale formulas both reduce to multiplying
        // the start values by F (see comment in commit message).
        const F = startRef.current.cs > 0 ? newScale / startRef.current.cs : 1;
        onSourceChange({
          scale: startRef.current.srcScale * F,
          offsetX: startRef.current.srcOffsetX * F,
          offsetY: startRef.current.srcOffsetY * F,
        });
      }
    }
  }, [dragMode, coords, source, onSourceChange, onCoordsChange, getCenterPoint, zoneW, zoneH, aspectLock]);

  const handlePointerUp = useCallback(() => {
    setDragMode(null);
  }, []);

  const scaleX = coords.scale;
  const scaleY = coords.scaleY ?? coords.scale;
  const rotation = coords.rotation ?? 0;

  // Photo box in parent container coords (fractions 0-1)
  const photoW = scaleX * zoneW;
  const photoH = scaleY * zoneH;
  const photoCx = zoneLeft + coords.x * zoneW;
  const photoCy = zoneTop + coords.y * zoneH;
  const photoLeft = photoCx - photoW / 2;
  const photoTop = photoCy - photoH / 2;

  const left = `${photoLeft * 100}%`;
  const top = `${photoTop * 100}%`;
  const width = `${photoW * 100}%`;
  const height = `${photoH * 100}%`;

  // Corner handles: filled circles, diagonal-resize cursors. Corner =
  // two-axis resize (and proportional with aspectLock in a later commit).
  const handleClass = `absolute w-3 h-3 rounded-full border-2 border-primary-foreground z-10 ${accentClass ? accentClass : "bg-primary"}`;
  // Edge handles: pill shapes aligned along their edge, single-axis-resize
  // cursors. Visually distinct from corners so the customer can tell at a
  // glance which handle does what.
  const edgeBase = `absolute z-10 border border-primary-foreground rounded-sm ${accentClass ? accentClass : "bg-primary"}`;
  const edgeHHandle = `${edgeBase} h-1.5 w-4`;   // horizontal pill for top/bottom
  const edgeVHandle = `${edgeBase} w-1.5 h-4`;   // vertical pill for left/right
  const isRotating = dragMode === "rotate";

  const isManaged = selected !== undefined;
  const showHandles = isManaged ? selected && !disabled : !disabled;
  const showBorder = isManaged ? selected : true;

  return (
    <div
      ref={containerRef}
      className={`absolute rounded-md transition-colors ${
        disabled ? "pointer-events-none" : "cursor-move"
      } ${showBorder ? `border-2 border-dashed ${disabled ? "border-muted-foreground/30" : (borderClass || "border-primary/60")}` : "border-2 border-transparent"} ${dragMode === "move" ? (borderClass ? borderClass.replace("/60", "") : "border-primary") : ""}`}
      style={{ left, top, width, height, touchAction: "none", transform: `rotate(${rotation}deg)` }}
      onPointerDown={(e) => handlePointerDown(e, "move")}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {children && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md pointer-events-none">
          {children}
        </div>
      )}

      {showHandles && isRotating && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-mono whitespace-nowrap pointer-events-none px-1.5 py-0.5 rounded bg-foreground text-background">
          {rotation}°
        </div>
      )}

      {/* Helper hint for photo layers (those that supply an aspectLock).
          Surfaces the corner/edge/center handle semantics so customers
          don't have to discover the new UX by trial and error. Kept off
          text layers where the same vocabulary would mislead — text
          edges resize, not crop. Hidden during rotation so the degree
          readout has the spot to itself. */}
      {showHandles && aspectLock && !isRotating && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap pointer-events-none px-1.5 py-0.5 rounded bg-foreground/80 text-background">
          კუთხეები: ზომა • კიდეები: ჭრა • ცენტრი: გადატანა (Alt: წანაცვლება)
        </div>
      )}

      {showHandles && (
        <>
          {/* Corner handles — two-axis resize */}
          <div className={`${handleClass} -top-1.5 -left-1.5 cursor-nwse-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tl")} />
          <div className={`${handleClass} -top-1.5 -right-1.5 cursor-nesw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tr")} />
          <div className={`${handleClass} -bottom-1.5 -left-1.5 cursor-nesw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-bl")} />
          <div className={`${handleClass} -bottom-1.5 -right-1.5 cursor-nwse-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-br")} />

          {/* Edge handles — one-axis resize (and crop in a later commit) */}
          <div
            className={`${edgeHHandle} -top-1 left-1/2 -translate-x-1/2 cursor-ns-resize`}
            onPointerDown={(e) => handlePointerDown(e, "resize-t")}
          />
          <div
            className={`${edgeHHandle} -bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize`}
            onPointerDown={(e) => handlePointerDown(e, "resize-b")}
          />
          <div
            className={`${edgeVHandle} -left-1 top-1/2 -translate-y-1/2 cursor-ew-resize`}
            onPointerDown={(e) => handlePointerDown(e, "resize-l")}
          />
          <div
            className={`${edgeVHandle} -right-1 top-1/2 -translate-y-1/2 cursor-ew-resize`}
            onPointerDown={(e) => handlePointerDown(e, "resize-r")}
          />

          <div
            className="absolute -bottom-8 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing z-10"
            onPointerDown={(e) => handlePointerDown(e, "rotate")}
          >
            <div className="flex flex-col items-center">
              <div className={`w-px h-3 ${accentClass ? accentClass : "bg-primary"} opacity-60`} />
              <div className={`w-5 h-5 rounded-full border-2 border-primary-foreground flex items-center justify-center ${accentClass ? accentClass : "bg-primary"}`}>
                <RotateCw className="w-2.5 h-2.5 text-white" />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
