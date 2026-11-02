import { useEffect, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog, DialogPortal, DialogOverlay } from "@/components/ui/dialog";

// Full-screen viewer for /portfolio. Built on the shadcn/Radix Dialog
// primitives (not DialogContent, whose centred card + English close label
// don't fit a photo viewer): Radix supplies Esc-to-close, the focus trap,
// body scroll lock and aria-modal. This component adds prev/next buttons,
// ArrowLeft/ArrowRight and a horizontal swipe.

export interface PortfolioLightboxImage {
  /** 1200w display URL (transformedDisplayUrl). */
  src: string;
  alt: string;
}

interface PortfolioLightboxProps {
  images: PortfolioLightboxImage[];
  /** Open image index, or null when closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const SWIPE_MIN_PX = 50;

export default function PortfolioLightbox({ images, index, onIndexChange, onClose }: PortfolioLightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  // The tile that opened the viewer. Radix only restores focus to a
  // Dialog.Trigger, and the tiles are plain buttons, so do it here.
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = index !== null && index >= 0 && index < images.length;
  const count = images.length;
  const current = open ? images[index] : null;

  const go = (delta: number) => {
    if (!open || count < 2) return;
    onIndexChange((index + delta + count) % count);
  };

  // Warm the neighbours so prev/next paint without a blank frame.
  useEffect(() => {
    if (!open || count < 2) return;
    for (const d of [1, -1]) {
      const img = new Image();
      img.src = images[(index + d + count) % count].src;
    }
  }, [open, index, count, images]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPortal>
        <DialogOverlay className="bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col items-center justify-center outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus({ preventScroll: true });
            returnFocus.current = null;
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
            else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
          }}
          onTouchStart={(e) => {
            const t = e.touches[0];
            touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const s = touchStart.current;
            const t = e.changedTouches[0];
            touchStart.current = null;
            if (!s || !t) return;
            const dx = t.clientX - s.x;
            const dy = t.clientY - s.y;
            if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
          }}
          // Clicking the dark backdrop around the photo closes, like the overlay.
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <DialogPrimitive.Title className="sr-only">ნამუშევრის ნახვა</DialogPrimitive.Title>

          <DialogPrimitive.Close
            ref={closeRef}
            aria-label="დახურვა"
            className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26BB89]"
          >
            <X className="h-6 w-6" />
          </DialogPrimitive.Close>

          {count > 1 && (
            <p className="absolute left-4 top-5 z-10 text-sm tabular-nums text-white/60" aria-live="polite">
              {open ? index + 1 : 0} / {count}
            </p>
          )}

          {current && (
            <figure className="flex max-h-full w-full flex-col items-center px-3 pb-20 pt-16 sm:px-20 sm:pb-4">
              <img
                key={current.src}
                src={current.src}
                alt={current.alt}
                className="max-h-[calc(100dvh-12rem)] max-w-full sm:max-h-[calc(100dvh-9rem)] select-none rounded-lg object-contain"
                draggable={false}
                decoding="async"
              />
              <DialogPrimitive.Description asChild>
                <figcaption className="mt-3 max-w-2xl text-center text-sm text-white/75">{current.alt}</figcaption>
              </DialogPrimitive.Description>
            </figure>
          )}

          {count > 1 && (
            <>
              <button
                type="button"
                aria-label="წინა ნამუშევარი"
                onClick={() => go(-1)}
                className="absolute left-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26BB89] sm:flex"
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                type="button"
                aria-label="შემდეგი ნამუშევარი"
                onClick={() => go(1)}
                className="absolute right-2 top-1/2 z-10 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#26BB89] sm:flex"
              >
                <ChevronRight className="h-7 w-7" />
              </button>
              {/* Phones: the arrows sit under the photo, within thumb reach. */}
              <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center gap-6 sm:hidden">
                <button
                  type="button"
                  aria-label="წინა ნამუშევარი"
                  onClick={() => go(-1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  aria-label="შემდეგი ნამუშევარი"
                  onClick={() => go(1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
