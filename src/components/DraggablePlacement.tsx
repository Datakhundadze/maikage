import { useRef, useCallback, useState, type ReactNode } from "react";
import type { PlacementCoords } from "@/lib/catalog";
import { RotateCw } from "lucide-react";

// Floor and ceiling for the design-layer scale relative to the placement
// zone. 0.1 keeps the layer from collapsing to invisible; 3 lets the user
// grow the layer well past the printable zone so long text has room — the
// composite still clips to the zone so the extra space is editor-only.
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

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
}: DraggablePlacementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const startRef = useRef({ mx: 0, my: 0, cx: 0, cy: 0, cs: 0, csY: 0, startAngle: 0, startRotation: 0 });

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

    if (mode === "rotate") {
      const center = getCenterPoint();
      const startAngle = Math.atan2(e.clientY - center.cy, e.clientX - center.cx);
      startRef.current = {
        mx: e.clientX, my: e.clientY,
        cx: coords.x, cy: coords.y,
        cs: coords.scale, csY: coords.scaleY ?? coords.scale,
        startAngle,
        startRotation: coords.rotation ?? 0,
      };
    } else {
      startRef.current = {
        mx: e.clientX, my: e.clientY,
        cx: coords.x, cy: coords.y,
        cs: coords.scale, csY: coords.scaleY ?? coords.scale,
        startAngle: 0, startRotation: 0,
      };
    }
  }, [disabled, coords, getCenterPoint, onSelect]);

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
      // No clamp on move: the design centre can go anywhere on the preview
      // (or even slightly off it). The outer preview container is
      // overflow-hidden so off-canvas movement is harmless visually.
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
      if (aspectLock && aspectLock > 0) {
        // Use whichever axis the cursor moved further in (in pixels) so
        // the resize tracks the user's dominant direction. Convert the
        // chosen-axis delta into the other axis via the aspect lock.
        // The box's effective pixel aspect on screen is
        //   (scale * zoneW * parentW) / (scaleY * zoneH * parentH)
        // which must equal aspectLock for the photo not to stretch:
        //   scaleY = scale * (zoneW * parentW) / (aspectLock * zoneH * parentH)
        // Parent dims cancel because dx is already in zone-fraction units.
        const aspectFactor = (zoneW) / (aspectLock * zoneH);
        const dxPx = Math.abs(dx * zoneW);
        const dyPx = Math.abs(dy * zoneH);
        if (dxPx >= dyPx) {
          const newScale = clamp(startRef.current.cs + sdx * 2);
          const newScaleY = clamp(newScale * aspectFactor);
          onCoordsChange({ ...coords, scale: newScaleY / aspectFactor, scaleY: newScaleY });
        } else {
          const newScaleY = clamp(startRef.current.csY + sdy * 2);
          const newScale = clamp(newScaleY * aspectFactor);
          onCoordsChange({ ...coords, scale: newScale, scaleY: newScale / aspectFactor });
        }
      } else {
        const newScaleX = clamp(startRef.current.cs + sdx * 2);
        const newScaleY = clamp(startRef.current.csY + sdy * 2);
        onCoordsChange({ ...coords, scale: newScaleX, scaleY: newScaleY });
      }
    }
  }, [dragMode, coords, onCoordsChange, getCenterPoint, zoneW, zoneH, aspectLock]);

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
