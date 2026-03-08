import { useRef, useCallback, useState, type ReactNode } from "react";
import type { PlacementCoords } from "@/lib/catalog";

interface DraggablePlacementProps {
  coords: PlacementCoords;
  onCoordsChange: (coords: PlacementCoords) => void;
  children?: ReactNode;
  disabled?: boolean;
}

type DragMode = "move" | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br" | null;

export default function DraggablePlacement({ coords, onCoordsChange, children, disabled }: DraggablePlacementProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const startRef = useRef({ mx: 0, my: 0, cx: 0, cy: 0, cs: 0, csY: 0 });

  const toNorm = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { nx: 0.5, ny: 0.5 };
    return {
      nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent, mode: DragMode) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragMode(mode);
    startRef.current = { mx: e.clientX, my: e.clientY, cx: coords.x, cy: coords.y, cs: coords.scale, csY: coords.scaleY ?? coords.scale };
  }, [disabled, coords]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragMode || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (e.clientX - startRef.current.mx) / rect.width;
    const dy = (e.clientY - startRef.current.my) / rect.height;

    if (dragMode === "move") {
      onCoordsChange({
        ...coords,
        x: Math.max(0.05, Math.min(0.95, startRef.current.cx + dx)),
        y: Math.max(0.05, Math.min(0.95, startRef.current.cy + dy)),
      });
    } else {
      // Resize: apply dx to scaleX, dy to scaleY
      const isLeft = dragMode.includes("l");
      const isTop = dragMode.includes("t");
      const sdx = isLeft ? -dx : dx;
      const sdy = isTop ? -dy : dy;
      const newScaleX = Math.max(0.1, Math.min(0.8, startRef.current.cs + sdx));
      const currentScaleY = coords.scaleY ?? coords.scale;
      const startScaleY = startRef.current.csY ?? startRef.current.cs;
      const newScaleY = Math.max(0.1, Math.min(0.8, startScaleY + sdy));
      onCoordsChange({ ...coords, scale: newScaleX, scaleY: newScaleY });
    }
  }, [dragMode, coords, onCoordsChange]);

  const handlePointerUp = useCallback(() => {
    setDragMode(null);
  }, []);

  const scaleX = coords.scale;
  const scaleY = coords.scaleY ?? coords.scale;
  const left = `${(coords.x - scaleX / 2) * 100}%`;
  const top = `${(coords.y - scaleY / 2) * 100}%`;
  const width = `${scaleX * 100}%`;
  const height = `${scaleY * 100}%`;

  const handleClass = "absolute w-3 h-3 rounded-full bg-primary border-2 border-primary-foreground z-10";

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: "none" }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className={`absolute border-2 border-dashed rounded-md transition-colors ${
          disabled ? "border-muted-foreground/30 pointer-events-none" : "border-primary/60 cursor-move"
        } ${dragMode === "move" ? "border-primary" : ""}`}
        style={{ left, top, width, height }}
        onPointerDown={(e) => handlePointerDown(e, "move")}
      >
        {/* Design image overlay */}
        {children && (
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-md pointer-events-none">
            {children}
          </div>
        )}

        {/* Coordinate readout */}
        <div className="absolute -top-5 left-0 text-[10px] text-primary font-mono whitespace-nowrap">
          {Math.round(coords.x * 100)}%, {Math.round(coords.y * 100)}% · {Math.round(coords.scale * 100)}%
        </div>

        {/* Resize handles */}
        {!disabled && (
          <>
            <div className={`${handleClass} -top-1.5 -left-1.5 cursor-nw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tl")} />
            <div className={`${handleClass} -top-1.5 -right-1.5 cursor-ne-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-tr")} />
            <div className={`${handleClass} -bottom-1.5 -left-1.5 cursor-sw-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-bl")} />
            <div className={`${handleClass} -bottom-1.5 -right-1.5 cursor-se-resize`} onPointerDown={(e) => handlePointerDown(e, "resize-br")} />
          </>
        )}
      </div>
    </div>
  );
}
