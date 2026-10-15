import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";

// The replace / add question for a design arriving from the floating chat onto
// a side that already has a photo. Purely presentational: SimplePage owns the
// pending design and what each answer does (see lib/placementChoice.ts).
//
// Rendered over the preview, in the same two slots as the seeded-generation
// overlay (mobile inline preview, desktop main column), so the existing design
// stays visible above the question.

interface PlacementChoiceProps {
  onReplace: () => void;
  onAdd: () => void;
  /** An AI action is running — only "add" is offered. */
  replaceDisabled: boolean;
}

export default function PlacementChoice({ onReplace, onAdd, replaceDisabled }: PlacementChoiceProps) {
  // On a phone the preview sits below the product panel — often below the
  // fold — so a question rendered there would go unseen. Bring it into view
  // once, when it appears. The copy in the hidden breakpoint slot has no box
  // and scrollIntoView is a no-op for it.
  const ref = useRef<HTMLDivElement>(null);
  // Rendered in two slots at once (one hidden per breakpoint) — unique ids.
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (el && el.getClientRects().length > 0) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="absolute inset-x-2 bottom-2 z-30 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm space-y-2"
    >
      <p id={titleId} className="text-sm font-semibold text-card-foreground text-center">
        ამ მხარეს უკვე არის დიზაინი
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onReplace}
          disabled={replaceDisabled}
          className="flex-1 min-h-11 h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
        >
          ჩანაცვლება
        </Button>
        <Button type="button" variant="outline" onClick={onAdd} className="flex-1 min-h-11 h-11 font-semibold">
          დამატება
        </Button>
      </div>
      {replaceDisabled && (
        <p className="text-[11px] text-muted-foreground text-center">
          ჩანაცვლება შესაძლებელი იქნება, როცა AI დაასრულებს მუშაობას.
        </p>
      )}
    </div>
  );
}
