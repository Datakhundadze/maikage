import { useDesign } from "@/hooks/useDesign";
import { useAppState } from "@/hooks/useAppState";
import { t } from "@/lib/i18n";
import DesignSection from "@/components/DesignSection";
import { Button } from "@/components/ui/button";
import { Zap, Sparkles, RefreshCw } from "lucide-react";
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

  const guideLabels = ["studio.guide.character", "studio.guide.scene", "studio.guide.style", "studio.guide.generate"];

  return (
    <div className="space-y-3">
      {/* Guide Box */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-muted-foreground">
          {guideLabels.map((key, i) => (
            <div key={key} className="space-y-1">
              <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary text-xs font-bold">{i + 1}</div>
              <span>{t(lang, key)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">{t(lang, "studio.guide.paste")}</p>
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

      {/* Style */}
      <DesignSection
        title={t(lang, "studio.style.title")}
        subtitle={t(lang, "studio.style.subtitle")}
        text={designParams.style}
        onTextChange={(txt) => dispatch({ type: "SET_STYLE", text: txt })}
        placeholder={t(lang, "studio.style.placeholder")}
        image={designParams.styleImage}
        onImageChange={(img) => dispatch({ type: "SET_STYLE_IMAGE", image: img })}
        collapsible expanded={expandedSections.style}
        onToggle={() => dispatch({ type: "TOGGLE_SECTION", section: "style" })}
        onViewImage={onViewImage}
      />

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

      {/* Speed Toggle */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={speed === "fast" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "fast" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "fast" })}
        >
          <Zap className="h-3.5 w-3.5" /> {t(lang, "studio.speed.fast")}
        </Button>
        <Button
          size="sm"
          variant={speed === "quality" ? "default" : "outline"}
          className={`flex-1 gap-1.5 ${speed === "quality" ? "bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
          onClick={() => dispatch({ type: "SET_SPEED", speed: "quality" })}
        >
          <Sparkles className="h-3.5 w-3.5" /> {t(lang, "studio.speed.pro")}
        </Button>
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
          disabled={!designParams.character.trim() || isProcessing}
          onClick={onGenerate}
        >
          {isProcessing ? t(lang, "studio.processing") : t(lang, "studio.generate")}
        </Button>
      )}
    </div>
  );
}
