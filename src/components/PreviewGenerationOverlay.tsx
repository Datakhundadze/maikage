import { getStatusInfo } from "@/lib/generationStatus";
import type { AppStatus } from "@/hooks/useDesign";
import type { Lang } from "@/lib/i18n";

// Progress, shown ON THE PRODUCT PREVIEW, for a generation seeded from the chat.
//
// WHY THIS EXISTS. A chat handoff opens the constructor in a fresh tab and
// starts generating immediately. The panel's own GenerationLoader reports that
// perfectly well — but the panel is the fourth block inside the sidebar's
// scroll container, so on a fresh load it is below the fold. The customer was
// left staring at an untouched garment for the length of a generation with no
// indication that anything was happening, which is exactly how a working
// feature comes to be reported as broken.
//
// SEEDED RUNS ONLY. A generation the customer started themselves was typed into
// the panel, so the panel is already on screen and already showing progress —
// a second indicator there would be noise. SimplePage gates this on the same
// seeded-run flag that drives the auto-transfer.
//
// SAME WORDS. The copy comes from lib/generationStatus, the module
// GenerationLoader now reads too, so the two surfaces cannot drift and the
// pipeline's existing onStatusChange stages are the only vocabulary.
//
// NO LAYOUT SHIFT, NO PERMANENT COVER. Absolutely positioned inside the
// preview's own box, so nothing reflows when it appears or goes; and it is
// mounted only while the run is in flight, so completion removes it. The
// backdrop is translucent with a light blur — the garment stays recognisable
// underneath, which matters because the colour is part of what the customer is
// waiting to see. pointer-events-none so it can never swallow a tap.
export default function PreviewGenerationOverlay({
  status,
  lang,
}: {
  status: AppStatus;
  lang: Lang;
}) {
  const info = getStatusInfo(status, lang);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/70 px-4 text-center backdrop-blur-[2px]">
      <div className="relative flex h-12 w-12 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        <span className="text-[10px] font-bold text-primary">AI</span>
      </div>
      {info && (
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{info.title}</p>
          <p className="animate-pulse font-mono text-[11px] text-muted-foreground">{info.log}</p>
        </div>
      )}
    </div>
  );
}
