import { STYLE_ENUM, styleForLang, type GenerateSuggestion } from "@/lib/generateSuggestion";
import { t, type Lang } from "@/lib/i18n";

// Style chips, shown INSTEAD of the single "დამიხატე" button when a generate
// block arrives with no style (style === "", the Auto default).
//
// Why chips rather than letting the model choose: the style string is
// load-bearing — the proxy's isRealistic routing reads it — so it must never be
// inferred. These come from the client's own STYLE_ENUM, so the value handed to
// the constructor is valid by construction, and the customer picks in one tap
// with no extra chat turn and no generation wasted on a guess.
//
// The chip LABEL is the page-language name (styleForLang) while the value put on
// the wire stays the canonical English enum — the same split the rest of
// generateSuggestion.ts uses.
//
// flex-wrap with content-sized chips means nothing is ever truncated at any
// panel width; in the ~360px widget the ten options wrap to about four rows.
export default function ChatStyleChips({
  lang,
  suggestion,
  onPick,
  compact = false,
}: {
  lang: Lang;
  suggestion: GenerateSuggestion;
  onPick: (g: GenerateSuggestion) => void;
  /** The widget's tighter sizing. Purely dimensional. */
  compact?: boolean;
}) {
  // Auto first so choosing can be skipped, then every enum style.
  const choices: { value: string; label: string }[] = [
    { value: "", label: lang === "en" ? "Auto" : "ავტომატური" },
    ...STYLE_ENUM.map((value) => ({ value, label: styleForLang(value, lang) || value })),
  ];

  return (
    <div className="mt-2">
      <p className={`mb-1.5 text-muted-foreground ${compact ? "text-[11px]" : "text-xs"}`}>
        {t(lang, "chat.chooseStyle")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((c) => (
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
