// The action button(s) under an assistant bubble, shared by the standalone
// /chat page and the floating ChatWidget.
//
// It exists so the two chats cannot diverge. They already ran the same parse
// and the same handoff; the BUTTON was the one piece copied into both files,
// and a second button would have doubled that. One component, one label, one
// icon, one set of classes — the only difference the callers may express is
// `compact`, which is the widget's tighter sizing and nothing else.
//
// Rendering is entirely driven by a suggestion that ALREADY VALIDATED. A failed
// parse leaves `suggestion` null upstream, this renders nothing, and the prose
// stands alone — never a broken button, never an error.
import { Shirt, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MockupSuggestion } from "@/lib/mockupSuggestion";
import type { ChatSuggestion, GenerateSuggestion } from "@/lib/generateSuggestion";
import ChatStyleChips from "@/components/ChatStyleChips";
import ChatOrderStatus from "@/components/ChatOrderStatus";
import type { Lang } from "@/lib/i18n";

export default function ChatSuggestionActions({
  suggestion,
  lang,
  compact = false,
  autoApplied = false,
  applied = false,
  onMockup,
  onGenerate,
  onSignIn,
}: {
  /** Page language — only used to label the style chips. */
  lang: Lang;
  /** The one validated suggestion for this turn, or null for prose alone. */
  suggestion: ChatSuggestion | null | undefined;
  /** The widget's tighter sizing. Purely dimensional. */
  compact?: boolean;
  /**
   * This turn's sketch was already applied to a constructor mounted in this
   * tab, so there is nothing left to press — the design is on the garment in
   * front of the customer. Set only by tryAutoOpenSketch's success, which is
   * reachable only for a block that spends no generation. False in every other
   * case, including a declined handoff, and then the button renders as before.
   */
  autoApplied?: boolean;
  /**
   * This turn's sketch was applied by a BUTTON PRESS (marked by the caller,
   * persisted next to `suggestion` itself so it survives reloads exactly as
   * long as the button does). The button renders spent — visible but disabled
   * — instead of silently re-applying the same layers on every press.
   */
  applied?: boolean;
  onMockup: (m: MockupSuggestion) => void;
  onGenerate: (g: GenerateSuggestion) => void;
  /** Open the login modal — the order-status card's guest path. */
  onSignIn: () => void;
}) {
  if (!suggestion) return null;

  // Order status renders its own card rather than a button: the lookup is
  // client-side and its result must never travel back through a message's
  // `content`, so it lives inside the component and nowhere else.
  if (suggestion.kind === "orderStatus") {
    return <ChatOrderStatus lang={lang} compact={compact} onSignIn={onSignIn} />;
  }

  const cls = `mt-2 w-full font-semibold bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 ${
    compact ? "h-9 gap-1.5 text-xs" : "h-10 gap-2"
  }`;
  const iconCls = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const size = compact ? "sm" : "default";

  if (suggestion.kind === "generate") {
    // No style named → let the customer pick from the client's own enum in one
    // tap rather than committing a generation to Auto. A style the model DID
    // name keeps the single button below, unchanged.
    if (!suggestion.generate.style) {
      return (
        <ChatStyleChips
          lang={lang}
          suggestion={suggestion.generate}
          onPick={onGenerate}
          compact={compact}
        />
      );
    }
    return (
      <Button onClick={() => onGenerate(suggestion.generate)} size={size} className={cls}>
        <Sparkles className={iconCls} />
        დამიხატე
      </Button>
    );
  }

  // Already applied automatically in this tab — the sketch IS the feedback.
  // Nothing renders at all: the auto path never showed a button, so there is
  // no control to account for. (Untouched behaviour.)
  if (autoApplied) return null;

  // Applied by a PRESS. The button stays — hiding it would erase the record of
  // what the tap did — but it is spent: disabled, and saying so. It used to
  // stay live forever (and `suggestion` is persisted, so it survived reloads),
  // and each press appended the same layers again; a customer pressed it three
  // times and got three identical text layers stacked on one spot. Wanting the
  // SAME design on a second garment does not need this button — the layers
  // stay on the canvas across a product or colour change in the constructor —
  // so a dead button here closes the stacking path without closing any real
  // one.
  if (applied) {
    return (
      <Button disabled size={size} className={cls} aria-disabled="true">
        <Shirt className={iconCls} />
        დაემატა ✓
      </Button>
    );
  }

  return (
    <Button onClick={() => onMockup(suggestion.mockup)} size={size} className={cls}>
      <Shirt className={iconCls} />
      ესკიზის ნახვა
    </Button>
  );
}
