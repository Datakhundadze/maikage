import type { Lang } from "@/lib/i18n";

// Single source of truth for the customer-facing AI style chips. Shared by
// the Studio panel (DesignStudioPanel) and the Simple-mode AI panel so both
// emit the IDENTICAL style label — the label is passed straight through as the
// `style` generation param, which the gemini-proxy uses for its isRealistic
// routing (/realistic|photo|რეალ/i). Keep these labels verbatim.
export function getStyleOptions(lang: Lang): string[] {
  return lang === "en"
    ? ["Realistic", "Animated", "Illustration", "Oil Art", "Anime", "Comics", "Line Art", "Graphic"]
    : ["რეალისტური", "ანიმაციური", "ილუსტრაცია", "ოილ არტი", "ანიმე", "კომიქსი", "Line Art", "გრაფიკა"];
}
