import { useDesign } from "@/hooks/useDesign";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import DesignSection from "@/components/DesignSection";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RefreshCw, ChevronDown, ChevronUp, Check, Zap, Sparkles } from "lucide-react";

interface DesignStudioPanelProps {
  onViewImage?: (src: string) => void;
  onGenerate?: () => void;
  hasResult?: boolean;
  onStartNew?: () => void;
  product?: string;
}

export default function DesignStudioPanel({ onViewImage, onGenerate, hasResult, onStartNew, product }: DesignStudioPanelProps) {
  const { state, dispatch } = useDesign();
  const { lang } = useAppState();
  const { designParams, speed, expandedSections, appStatus } = state;

  const isProcessing = appStatus !== "IDLE" && appStatus !== "COMPLETE" && appStatus !== "ERROR";

  const styleOptions = [
    "რეალისტური",
    "ანიმაციური",
    "ილუსტრაცია",
    "ოილ არტი",
    "ანიმე",
    "კომიქსი",
    "Line Art",
    "გრაფიკა",
  ];

  const steps = [
    { key: "studio.guide.character", hintKey: "studio.guide.characterHint" },
    { key: "studio.guide.scene",     hintKey: "studio.guide.sceneHint" },
    { key: "studio.guide.style",     hintKey: "studio.guide.styleHint" },
    { key: "studio.guide.generate",  hintKey: "studio.guide.generateHint" },
  ];

  // Track step completion based on filled content
  const stepDone = [
    designParams.character.trim().length > 0 || designParams.characterImages.length > 0,
    designParams.scene.trim().length > 0 || !!designParams.sceneImage,
    designParams.style.trim().length > 0,
    false, // "Generate" step is never "done", it's always the target
  ];
  // Active step = first incomplete step (or last)
  const activeStep = stepDone.findIndex((d) => !d);

  return (
    <div className="space-y-3">
      {/* Step progress */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="relative flex items-start justify-between">
          {/* Connecting line behind the circles */}
          <div className="absolute top-[18px] left-[calc(12.5%)] right-[calc(12.5%)] h-0.5 bg-border" />
          <div
            className="absolute top-[18px] left-[calc(12.5%)] h-0.5 bg-primary transition-all duration-500"
            style={{ width: `${(Math.max(0, activeStep === -1 ? 3 : activeStep) / 3) * 75}%` }}
          />

          {steps.map(({ key, hintKey }, i) => {
            const done = stepDone[i];
            const active = !done && i === activeStep;
            return (
              <Tooltip key={key} delayDuration={200}>
                <TooltipTrigger asChild>
                  <div className="relative z-10 flex flex-col items-center gap-1.5 flex-1 cursor-default">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold transition-all
                        ${done
                          ? "bg-primary text-primary-foreground"
                          : active
                            ? "bg-primary text-primary-foreground ring-2 ring-primary/20 shadow-lg shadow-primary/40 scale-110"
                            : "bg-muted text-muted-foreground opacity-55"
                        }`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </div>
                    <span className={`text-[11px] font-semibold leading-tight text-center
                      ${active ? "text-primary" : done ? "text-primary/70" : "text-muted-foreground"}`}>
                      {t(lang, key)}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs max-w-[140px] text-center">
                  {t(lang, hintKey)}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <p className="mt-2.5 text-center text-[10px] text-muted-foreground border-t border-border pt-2">
          {t(lang, "studio.guide.paste")}
        </p>
      </div>


      {/* Character */}
      <DesignSection
        title={t(lang, "studio.character.title")}
        subtitle={t(lang, "studio.character.subtitle")}
        text={designParams.character}
        onTextChange={(txt) => dispatch({ type: "SET_CHARACTER", text: txt })}
        placeholder={t(lang, "studio.character.placeholder")}
        images={designParams.characterImages}
        onAddImage={(img) => dispatch({ type: "ADD_CHARACTER_IMAGE", image: img })}
        onRemoveImage={(i) => dispatch({ type: "REMOVE_CHARACTER_IMAGE", index: i })}
        onViewImage={onViewImage}
      />

      {/* Scene */}
      <DesignSection
        title={t(lang, "studio.scene.title")}
        subtitle={t(lang, "studio.scene.subtitle")}
        text={designParams.scene}
        onTextChange={(txt) => dispatch({ type: "SET_SCENE", text: txt })}
        placeholder={t(lang, "studio.scene.placeholder")}
        image={designParams.sceneImage}
        onImageChange={(img) => dispatch({ type: "SET_SCENE_IMAGE", image: img })}
        collapsible expanded={expandedSections.scene}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "scene" })}
        onViewImage={onViewImage}
      />

      {/* Style - Pill Chips */}
      {!expandedSections.style ? (
        <button
          onClick={() => dispatch({ type: "TOGGLE_SECTION", section: "style" })}
          className="w-full flex items-center justify-between rounded-xl border border-border bg-card p-3 text-sm font-medium text-card-foreground hover:border-banana-500/50 transition-colors"
        >
          <span>{t(lang, "studio.style.title")}{designParams.style ? ` — ${designParams.style}` : ""}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between p-3 border-b border-border">
            <div>
              <h4 className="text-sm font-semibold text-card-foreground">{t(lang, "studio.style.title")}</h4>
              <p className="text-xs text-muted-foreground">{t(lang, "studio.style.subtitle")}</p>
            </div>
            <button onClick={() => dispatch({ type: "TOGGLE_SECTION", section: "style" })} className="text-muted-foreground hover:text-foreground">
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3 grid grid-cols-4 gap-1.5">
            {styleOptions.map((opt) => {
              const active = designParams.style === opt;
              return (
                <button
                  key={opt}
                  onClick={() => dispatch({ type: "SET_STYLE", text: active ? "" : opt })}
                  className={`rounded-lg px-2 py-1.5 text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-amber-500 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Typography */}
      <DesignSection
        title={t(lang, "studio.typography.title")}
        subtitle={t(lang, "studio.typography.subtitle")}
        text={designParams.text}
        onTextChange={(txt) => dispatch({ type: "SET_TEXT", text: txt })}
        placeholder={t(lang, "studio.typography.placeholder")}
        image={designParams.textImage}
        onImageChange={(img) => dispatch({ type: "SET_TEXT_IMAGE", image: img })}
        collapsible expanded={expandedSections.text}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "text" })}
        onViewImage={onViewImage}
      />

      {/* Speed toggle */}
      <div className="flex gap-1.5 rounded-xl border border-border bg-card p-1.5">
        <button
          onClick={() => dispatch({ type: "SET_SPEED", speed: "fast" })}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            speed === "fast"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="h-3 w-3" />
          {lang === "ge" ? "სწრაფი" : "FAST"}
        </button>
        <button
          onClick={() => dispatch({ type: "SET_SPEED", speed: "pro" })}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
            speed === "pro"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="h-3 w-3" />
          {lang === "ge" ? "პრო" : "PRO"}
        </button>
      </div>

      {/* Action Buttons */}
      {hasResult ? (
        <div className="space-y-2">
          <Button
            className="w-full h-12 gap-1.5 bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 font-semibold"
            disabled={isProcessing}
            onClick={onGenerate}
          >
            <RefreshCw className="h-4 w-4" /> {t(lang, "studio.regenerate")}
          </Button>
          <button
            onClick={onStartNew}
            className="w-full text-center text-sm text-primary hover:text-primary/80"
          >
            {t(lang, "studio.startNew")}
          </button>
        </div>
      ) : (
        <Button
          className="w-full h-12 bg-foreground text-background hover:bg-foreground/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 font-semibold text-base"
          disabled={(!designParams.character.trim() && designParams.characterImages.length === 0) || isProcessing}
          onClick={onGenerate}
        >
          {isProcessing ? t(lang, "studio.processing") : t(lang, "studio.generate")}
        </Button>
      )}
    </div>
  );
}
