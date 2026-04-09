import { useRef, useCallback, useState, type ReactNode } from "react";
import type { PlacementCoords } from "@/lib/catalog";
import { RotateCw } from "lucide-react";

interface DraggablePlacementProps {
  coords: PlacementCoords;
  onCoordsChange: (coords: PlacementCoords) => void;
  children?: ReactNode;
  disabled?: boolean;
  /** Color for border/handles, defaults to primary */
  accentClass?: string;
  /** Border color class, defaults to border-primary/60 */
  borderClass?: string;
  /** Hide coordinate readout */
  hideReadout?: boolean;
  /** Whether this layer is selected (shows handles/border) */
  selected?: boolean;
  /** Called when the layer is clicked to select it */
  onSelect?: () => void;
}

type DragMode = "move" | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br" | "rotate" | null;

export default function DraggablePlacement({ coords, onCoordsChange, children, disabled, accentClass, borderClass, hideReadout, selected, onSelect }: DraggablePlacementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const startRef = useRef({ mx: 0, my: 0, cx: 0, cy: 0, cs: 0, csY: 0, startAngle: 0, startRotation: 0 });

  const getCenterPoint = useCallback(() => {
    const parent = containerRef.current?.parentElement;
    if (!parent) return { cx: 0, cy: 0 };
    const rect = parent.getBoundingClientRect();
    const cx = rect.left + coords.x * rect.width;
    const cy = rect.top + coords.y * rect.height;
    return { cx, cy };
  }, [coords.x, coords.y]);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (disabled) return;
    // If selection is managed and not selected, just select on click
    if (selected === false && mode === "move") {
      onSelect?.();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
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
  }, [disabled, coords, getCenterPoint]);

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
      // Normalize to -180..180
      while (newRotation > 180) newRotation -= 360;
      while (newRotation < -180) newRotation += 360;
      onCoordsChange({ ...coords, rotation: Math.round(newRotation) });
      return;
    }

    const dx = (e.clientX - startRef.current.mx) / rect.width;
    const dy = (e.clientY - startRef.current.my) / rect.height;

    if (dragMode === "move") {
      onCoordsChange({
        ...coords,
        x: Math.max(0.05, Math.min(0.95, startRef.current.cx + dx)),
        y: Math.max(0.05, Math.min(0.95, startRef.current.cy + dy)),
      });
    } else {
      const isLeft = dragMode.includes("l");
      const isTop = dragMode.includes("t");
      const sdx = isLeft ? -dx : dx;
      const sdy = isTop ? -dy : dy;
      const newScaleX = Math.max(0.05, Math.min(0.9, startRef.current.cs + sdx));
      const startScaleY = startRef.current.csY;
      const newScaleY = Math.max(0.05, Math.min(0.9, startScaleY + sdy));
      onCoordsChange({ ...coords, scale: newScaleX, scaleY: newScaleY });
    }
  }, [dragMode, coords, onCoordsChange, getCenterPoint]);

  const handlePointerUp = useCallback(() => {
    setDragMode(null);
  }, []);

  const scaleX = coords.scale;
  const scaleY = coords.scaleY ?? coords.scale;
  const rotation = coords.rotation ?? 0;
  const left = `${(coords.x - scaleX / 2) * 100}%`;
  const top = `${(coords.y - scaleY / 2) * 100}%`;
  const width = `${scaleX * 100}%`;
  const height = `${scaleY * 100}%`;

  const handleClass = `absolute w-3 h-3 rounded-full border-2 border-primary-foreground z-10 ${accentClass ? accentClass : "bg-primary"}`;
  const isRotating = dragMode === "rotate";

  // When `selected` prop is provided, use it to control visibility of handles/border
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
      {/* Design content */}
      {children && (
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md pointer-events-none">
          {children}
        </div>
      )}

      {/* Rotation readout */}
      {showHandles && isRotating && (
        <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-mono whitespace-nowrap pointer-events-none px-1.5 py-0.5 rounded bg-foreground text-background">
          {rotation}°
        </div>
      )}


      {/* Resize handles */}
      {showHandles && (
        <>
          <div className={`${handleClass} -top-1.5 -left-1.5 cursor-nw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tl")} />
          <div className={`${handleClass} -top-1.5 -right-1.5 cursor-ne-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tr")} />
          <div className={`${handleClass} -bottom-1.5 -left-1.5 cursor-sw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-bl")} />
          <div className={`${handleClass} -bottom-1.5 -right-1.5 cursor-se-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-br")} />

          {/* Rotation handle */}
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
