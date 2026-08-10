import { styleChoices, type GenerateSuggestion } from "@/lib/mockupSuggestion";
import { t } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";

// Style chips shown INSTEAD of the single "დამიხატე" button when a generate
// block arrives without a style.
//
// Why chips rather than letting the model pick: a style must never be inferred.
// These come from the client's own getStyleOptions(), so the value handed to the
// constructor is valid by construction, and the customer chooses in one tap
// with no extra chat turn (and no wasted generation on a guessed style).
//
// Shared by ChatPage and ChatWidget so the two can't diverge. flex-wrap with
// content-sized chips means nothing is ever truncated at any panel width — in
// the ~360px widget the ten options wrap to roughly four rows.
export default function ChatStyleChips({
  lang,
  suggestion,
  onPick,
  compact = false,
}: {
  lang: Lang;
  suggestion: GenerateSuggestion;
  onPick: (g: GenerateSuggestion) => void;
  /** Widget panel — slightly tighter type and padding. */
  compact?: boolean;
}) {
  return (
    <div className="mt-2">
      <p className={`mb-1.5 text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}>
        {t(lang, "chat.chooseStyle")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {styleChoices(lang).map((c) => (
          <button
            key={c.value || "__auto__"}
            type="button"
            onClick={() => onPick({ ...suggestion, style: c.value })}
            className={`rounded-lg bg-background/70 font-medium text-foreground transition-colors hover:bg-primary hover:text-primary-foreground ${
              compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
