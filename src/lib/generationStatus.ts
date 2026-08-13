import type { AppStatus } from "@/hooks/useDesign";
import type { Lang } from "@/lib/i18n";

// The one set of progress strings for a running generation, keyed by the
// pipeline's own onStatusChange stages.
//
// Extracted from GenerationLoader so a SECOND surface can render the same words
// without inventing a parallel vocabulary: PreviewGenerationOverlay reports the
// same run over the product preview when the generation was seeded from the
// chat and the panel is below the fold. Two surfaces, one copy — and a plain
// module rather than a component file, so neither import breaks fast refresh.

const STATUS_INFO_EN: Record<string, { title: string; log: string }> = {
  GENERATING_DESIGN: {
    title: "Generative Design",
    log: "Assembling prompt → sending to AI model...",
  },
  PROCESSING_TRANSPARENCY: {
    title: "Processing Alpha...",
    log: "Difference matting → extracting transparency...",
  },
  GENERATING_MOCKUP: {
    title: "Virtual Photography",
    log: "Compositing design onto product photo...",
  },
};

const STATUS_INFO_GE: Record<string, { title: string; log: string }> = {
  GENERATING_DESIGN: {
    title: "AI დიზაინი",
    log: "პრომპტის მომზადება → AI მოდელზე გაგზავნა...",
  },
  PROCESSING_TRANSPARENCY: {
    title: "Alpha დამუშავება...",
    log: "ფონის მოცილება → გამჭვირვალობის გამოყოფა...",
  },
  GENERATING_MOCKUP: {
    title: "ვირტუალური ფოტოგრაფია",
    log: "დიზაინი ედება პროდუქტის ფოტოს...",
  },
};

/** Progress copy for a stage, in the page language, or null for an unknown stage. */
export function getStatusInfo(status: AppStatus, lang: Lang): { title: string; log: string } | null {
  return (lang === "en" ? STATUS_INFO_EN : STATUS_INFO_GE)[status] ?? null;
}
